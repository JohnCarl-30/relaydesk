#!/usr/bin/env node
/*
 * node scripts/backup.mjs --once   one backup now, then exit (non-zero on failure)
 * node scripts/backup.mjs          stay up and back up every day at RELAYDESK_BACKUP_AT
 *
 * Env:
 *   RELAYDESK_DB_PATH        the live database (default data/relaydesk.db)
 *   RELAYDESK_BACKUP_DIR     where snapshots go (default <db dir>/backups)
 *   RELAYDESK_BACKUP_KEEP    snapshots kept on disk (default 7)
 *   RELAYDESK_BACKUP_AT      daily time, HH:MM in UTC (default 18:00, which is 02:00 in Manila)
 *   RELAYDESK_BACKUP_S3_*    optional off-server copy; see s3FromEnv in backup-lib.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { createBackup, pruneBackups, s3FromEnv, uploadBackup } from "./backup-lib.mjs";

const dbPath = process.env.RELAYDESK_DB_PATH ?? path.join(process.cwd(), "data", "relaydesk.db");
const dir = process.env.RELAYDESK_BACKUP_DIR ?? path.join(path.dirname(dbPath), "backups");
const keep = Number(process.env.RELAYDESK_BACKUP_KEEP ?? 7);
const at = process.env.RELAYDESK_BACKUP_AT ?? "18:00";

function log(event, fields = {}) {
  console.log(JSON.stringify({ at: new Date().toISOString(), event, ...fields }));
}

async function runOnce() {
  const target = s3FromEnv();
  const backup = await createBackup(dbPath, dir);
  log("backup.created", { file: backup.name, bytes: backup.bytes, counts: backup.counts });
  if (target) {
    const key = await uploadBackup(backup.file, target);
    log("backup.uploaded", { bucket: target.bucket, key });
  }
  const pruned = pruneBackups(dir, keep);
  if (pruned.length) log("backup.pruned", { files: pruned.map((f) => path.basename(f)) });
  // The last result, for a person (or a future health check) to read.
  fs.writeFileSync(
    path.join(dir, "last.json"),
    JSON.stringify({ ok: true, at: new Date().toISOString(), file: backup.name, uploaded: Boolean(target) }),
  );
}

function msUntilNext(hhmm, now = new Date()) {
  const [h, m] = hhmm.split(":").map(Number);
  if (!(h >= 0 && h < 24 && m >= 0 && m < 60)) throw new Error(`RELAYDESK_BACKUP_AT must be HH:MM, got "${hhmm}"`);
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), h, m));
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next.getTime() - now.getTime();
}

async function attempt() {
  try {
    await runOnce();
    return true;
  } catch (err) {
    log("backup.failed", { error: err instanceof Error ? err.message : String(err) });
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, "last.json"),
        JSON.stringify({ ok: false, at: new Date().toISOString(), error: String(err) }),
      );
    } catch {
      /* the log line above is the record */
    }
    return false;
  }
}

if (process.argv.includes("--once")) {
  process.exit((await attempt()) ? 0 : 1);
} else {
  log("backup.scheduled", { daily_at_utc: at, keep, dir, s3: Boolean(s3FromEnv()) });
  const loop = async () => {
    const wait = msUntilNext(at);
    log("backup.next", { in_minutes: Math.round(wait / 60_000) });
    setTimeout(async () => {
      await attempt();
      void loop();
    }, wait);
  };
  void loop();
  for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => process.exit(0));
}
