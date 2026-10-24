import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import Database from "better-sqlite3";
import {
  createBackup,
  downloadBackup,
  listBackups,
  pruneBackups,
  restoreBackup,
  s3FromEnv,
  uploadBackup,
} from "../../scripts/backup-lib.mjs";

const root = fs.mkdtempSync(join(tmpdir(), "relaydesk-backup-"));
const dbPath = join(root, "live", "relaydesk.db");
const backups = join(root, "backups");

function live() {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  return db;
}

before(() => {
  fs.mkdirSync(join(root, "live"));
  const db = live();
  db.exec(`
    CREATE TABLE businesses (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE tickets (id TEXT PRIMARY KEY, business_id TEXT);
    INSERT INTO businesses VALUES ('kape', 'Kape Kalye');
    INSERT INTO tickets VALUES ('tkt_1', 'kape'), ('tkt_2', 'kape');
  `);
  db.close();
});

after(() => fs.rmSync(root, { recursive: true, force: true }));

describe("backups", () => {
  it("snapshots a database that another connection is writing to", async () => {
    const writer = live();
    writer.prepare("INSERT INTO tickets VALUES ('tkt_3', 'kape')").run(); // sits in the WAL
    try {
      const backup = await createBackup(dbPath, backups, new Date("2026-10-23T18:00:00Z"));
      assert.match(backup.name, /^relaydesk-2026-10-23T18-00-00-000Z\.db\.gz$/);
      assert.equal(backup.counts.tickets, 3, "includes what's still in the WAL");
      assert.equal(backup.counts.businesses, 1);
      assert.ok(backup.bytes > 0);
    } finally {
      writer.close();
    }
  });

  it("leaves only the snapshot behind, not the temp copy's -wal and -shm", async () => {
    const dir = join(root, "clean");
    const backup = await createBackup(dbPath, dir, new Date("2026-10-23T19:00:00Z"));
    assert.deepEqual(fs.readdirSync(dir), [backup.name]);
  });

  it("keeps only the newest snapshots", async () => {
    for (const day of ["24", "25", "26"]) {
      await createBackup(dbPath, backups, new Date(`2026-10-${day}T18:00:00Z`));
    }
    const removed = pruneBackups(backups, 2);
    assert.equal(removed.length, 2);
    assert.deepEqual(
      listBackups(backups).map((f) => f.split("/").at(-1)),
      ["relaydesk-2026-10-25T18-00-00-000Z.db.gz", "relaydesk-2026-10-26T18-00-00-000Z.db.gz"],
    );
  });

  it("restores a snapshot over a changed database and keeps the old one", async () => {
    const db = live();
    db.exec("DELETE FROM tickets; INSERT INTO businesses VALUES ('oops', 'Added after the backup');");
    db.close();

    const result = await restoreBackup(listBackups(backups).at(-1)!, dbPath, new Date("2026-10-27T01:00:00Z"));
    assert.deepEqual(
      { tickets: result.counts.tickets, businesses: result.counts.businesses },
      { tickets: 3, businesses: 1 },
    );
    assert.ok(result.keptAs && fs.existsSync(result.keptAs));
    const kept = new Database(result.keptAs, { readonly: true });
    assert.equal((kept.prepare("SELECT COUNT(*) AS n FROM businesses").get() as { n: number }).n, 2);
    kept.close();
    const leftovers = fs.readdirSync(join(root, "live")).filter((name) => name.startsWith(".restore-"));
    assert.deepEqual(leftovers, [], "the incoming copy's -wal and -shm go too");
  });

  it("refuses a damaged backup and leaves the database alone", async () => {
    const bad = join(backups, "relaydesk-broken.db.gz");
    fs.writeFileSync(bad, "not a gzip");
    await assert.rejects(restoreBackup(bad, dbPath));
    const db = new Database(dbPath, { readonly: true });
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM tickets").get() as { n: number }).n, 3);
    db.close();
    fs.rmSync(bad);
  });
});

describe("off-server copies", () => {
  it("needs all four S3 settings or none", () => {
    assert.equal(s3FromEnv({}), null);
    assert.throws(() => s3FromEnv({ RELAYDESK_BACKUP_S3_BUCKET: "b" }), /all of/);
  });

  it("uploads with a signed PUT and downloads the newest", async () => {
    const objects = new Map<string, Buffer>();
    const auth: string[] = [];
    const server = http.createServer((req, res) => {
      auth.push(req.headers.authorization ?? "");
      const url = new URL(req.url ?? "/", "http://x");
      if (req.method === "PUT") {
        const chunks: Buffer[] = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", () => {
          objects.set(decodeURIComponent(url.pathname), Buffer.concat(chunks));
          res.end();
        });
      } else if (url.searchParams.get("list-type") === "2") {
        const prefix = `/bucket/${url.searchParams.get("prefix")}`;
        const keys = [...objects.keys()].filter((k) => k.startsWith(prefix)).map((k) => k.slice("/bucket/".length));
        res.end(`<ListBucketResult>${keys.map((k) => `<Contents><Key>${k}</Key></Contents>`).join("")}</ListBucketResult>`);
      } else {
        const body = objects.get(decodeURIComponent(url.pathname));
        res.statusCode = body ? 200 : 404;
        res.end(body);
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as { port: number };
    try {
      const target = s3FromEnv({
        RELAYDESK_BACKUP_S3_ENDPOINT: `http://127.0.0.1:${port}/`,
        RELAYDESK_BACKUP_S3_BUCKET: "bucket",
        RELAYDESK_BACKUP_S3_ACCESS_KEY_ID: "AKID",
        RELAYDESK_BACKUP_S3_SECRET_ACCESS_KEY: "secret",
      })!;
      const [older, newer] = listBackups(backups);
      await uploadBackup(newer, target);
      await uploadBackup(older, target);
      assert.match(auth[0], /^AWS4-HMAC-SHA256 Credential=AKID\/\d{8}\/auto\/s3\/aws4_request/);

      const fetched = await downloadBackup(target, join(root, "downloaded"));
      assert.equal(fetched.split("/").at(-1), newer.split("/").at(-1), "the newest by name, not upload order");
      assert.deepEqual(fs.readFileSync(fetched), fs.readFileSync(newer));
    } finally {
      server.close();
    }
  });
});
