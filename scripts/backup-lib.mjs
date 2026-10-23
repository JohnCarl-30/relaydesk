/*
 * Database backups. Plain JavaScript on purpose: the production image has no
 * TypeScript tooling, and these run there (see the `backup` service in
 * docker-compose.yml and RUNBOOK.md).
 *
 * A backup is SQLite's online backup of the live database (safe while the app
 * writes to it), checked with PRAGMA integrity_check, then gzipped.
 */
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import zlib from "node:zlib";
import Database from "better-sqlite3";

export const BACKUP_PREFIX = "relaydesk-";
export const BACKUP_SUFFIX = ".db.gz";

function stamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

/** "ok", or SQLite's first complaint. */
export function integrityOf(file) {
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    return db.pragma("integrity_check", { simple: true });
  } finally {
    db.close();
  }
}

/** Counts that make a restore easy to eyeball: did the businesses and tickets come back? */
export function summarize(file) {
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    const count = (table) => {
      const exists = db
        .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get(table);
      return exists ? db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n : 0;
    };
    return {
      businesses: count("businesses"),
      articles: count("articles"),
      conversations: count("conversations"),
      tickets: count("tickets"),
      staff: count("staff"),
    };
  } finally {
    db.close();
  }
}

/**
 * Writes `<dir>/relaydesk-<timestamp>.db.gz` from the live database at
 * `dbPath`, and refuses to keep a snapshot that fails its integrity check.
 */
export async function createBackup(dbPath, dir, now = new Date()) {
  fs.mkdirSync(dir, { recursive: true });
  const name = `${BACKUP_PREFIX}${stamp(now)}${BACKUP_SUFFIX}`;
  const raw = path.join(dir, `.${name}.tmp`);
  const file = path.join(dir, name);
  const source = new Database(dbPath, { fileMustExist: true });
  try {
    await source.backup(raw);
  } finally {
    source.close();
  }
  try {
    const integrity = integrityOf(raw);
    if (integrity !== "ok") throw new Error(`snapshot failed integrity_check: ${integrity}`);
    const counts = summarize(raw);
    await pipeline(fs.createReadStream(raw), zlib.createGzip({ level: 9 }), fs.createWriteStream(file));
    return { file, name, bytes: fs.statSync(file).size, counts };
  } finally {
    fs.rmSync(raw, { force: true });
  }
}

export function listBackups(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.startsWith(BACKUP_PREFIX) && name.endsWith(BACKUP_SUFFIX))
    .sort()
    .map((name) => path.join(dir, name));
}

/** Keeps the newest `keep` backups in `dir` and deletes the rest. Returns what it deleted. */
export function pruneBackups(dir, keep) {
  const all = listBackups(dir);
  const old = all.slice(0, Math.max(0, all.length - keep));
  for (const file of old) fs.rmSync(file);
  return old;
}

/**
 * Puts a backup back as the database at `dbPath`. The app must be stopped:
 * swapping the file under a running server loses whatever it writes next.
 * The current database is kept beside it as `<db>.before-restore-<timestamp>`.
 */
export async function restoreBackup(backupFile, dbPath, now = new Date()) {
  const dir = path.dirname(dbPath);
  fs.mkdirSync(dir, { recursive: true });
  const incoming = path.join(dir, `.restore-${stamp(now)}.tmp`);
  await pipeline(fs.createReadStream(backupFile), zlib.createGunzip(), fs.createWriteStream(incoming));
  try {
    const integrity = integrityOf(incoming);
    if (integrity !== "ok") throw new Error(`backup failed integrity_check: ${integrity}`);
  } catch (err) {
    fs.rmSync(incoming, { force: true });
    throw err;
  }
  let keptAs = null;
  if (fs.existsSync(dbPath)) {
    keptAs = `${dbPath}.before-restore-${stamp(now)}`;
    // Fold the WAL into the old file first, so the kept copy is complete on its own.
    const old = new Database(dbPath);
    old.pragma("wal_checkpoint(TRUNCATE)");
    old.close();
    fs.renameSync(dbPath, keptAs);
  }
  for (const suffix of ["-wal", "-shm"]) fs.rmSync(`${dbPath}${suffix}`, { force: true });
  fs.renameSync(incoming, dbPath);
  return { restored: dbPath, keptAs, counts: summarize(dbPath) };
}

/**
 * S3-compatible upload target (Cloudflare R2, Backblaze B2, MinIO, AWS) from the environment, or null.
 * @param {Record<string, string | undefined>} [env]
 */
export function s3FromEnv(env = process.env) {
  const endpoint = env.RELAYDESK_BACKUP_S3_ENDPOINT;
  const bucket = env.RELAYDESK_BACKUP_S3_BUCKET;
  const accessKeyId = env.RELAYDESK_BACKUP_S3_ACCESS_KEY_ID;
  const secretAccessKey = env.RELAYDESK_BACKUP_S3_SECRET_ACCESS_KEY;
  if (!endpoint && !bucket) return null;
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "Set all of RELAYDESK_BACKUP_S3_ENDPOINT, _BUCKET, _ACCESS_KEY_ID and _SECRET_ACCESS_KEY, or none.",
    );
  }
  return {
    endpoint: endpoint.replace(/\/+$/, ""),
    bucket,
    accessKeyId,
    secretAccessKey,
    region: env.RELAYDESK_BACKUP_S3_REGION || "auto",
    prefix: (env.RELAYDESK_BACKUP_S3_PREFIX ?? "relaydesk/").replace(/^\/+/, ""),
  };
}

async function s3Client(target) {
  const { AwsClient } = await import("aws4fetch");
  return new AwsClient({
    accessKeyId: target.accessKeyId,
    secretAccessKey: target.secretAccessKey,
    region: target.region,
    service: "s3",
  });
}

function objectUrl(target, key) {
  // Path-style (endpoint/bucket/key) works on R2, B2, MinIO, and AWS.
  return `${target.endpoint}/${target.bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

/** Uploads one backup; retention off-server is the bucket's lifecycle rule. */
export async function uploadBackup(file, target) {
  const client = await s3Client(target);
  const key = `${target.prefix}${path.basename(file)}`;
  const res = await client.fetch(objectUrl(target, key), {
    method: "PUT",
    body: fs.readFileSync(file),
    headers: { "Content-Type": "application/gzip" },
  });
  if (!res.ok) throw new Error(`upload failed: ${res.status} ${await res.text()}`);
  return key;
}

/** Downloads `key` (or the newest backup under the prefix) into `dir`. */
export async function downloadBackup(target, dir, key) {
  const client = await s3Client(target);
  if (!key) {
    const list = await client.fetch(
      `${target.endpoint}/${target.bucket}?list-type=2&prefix=${encodeURIComponent(target.prefix)}`,
    );
    if (!list.ok) throw new Error(`list failed: ${list.status} ${await list.text()}`);
    const keys = [...(await list.text()).matchAll(/<Key>([^<]+)<\/Key>/g)]
      .map((m) => m[1].replace(/&amp;/g, "&"))
      .filter((k) => k.endsWith(BACKUP_SUFFIX))
      .sort();
    key = keys.at(-1);
    if (!key) throw new Error(`no backups under ${target.bucket}/${target.prefix}`);
  }
  const res = await client.fetch(objectUrl(target, key));
  if (!res.ok) throw new Error(`download failed: ${res.status} ${await res.text()}`);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, path.basename(key));
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return file;
}
