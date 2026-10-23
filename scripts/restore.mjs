#!/usr/bin/env node
/*
 * Puts a backup back. STOP THE APP FIRST; see RUNBOOK.md "Restore a backup".
 *
 *   node scripts/restore.mjs --latest --yes           newest snapshot in RELAYDESK_BACKUP_DIR
 *   node scripts/restore.mjs --file <path.db.gz> --yes
 *   node scripts/restore.mjs --from-s3 [key] --yes    newest (or that) object in the bucket
 *
 * Without --yes it only says what it would restore. The database being
 * replaced is kept as <db>.before-restore-<timestamp>.
 */
import path from "node:path";
import { parseArgs } from "node:util";
import {
  downloadBackup,
  integrityOf,
  listBackups,
  restoreBackup,
  s3FromEnv,
  summarize,
} from "./backup-lib.mjs";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    latest: { type: "boolean" },
    file: { type: "string" },
    "from-s3": { type: "boolean" },
    yes: { type: "boolean" },
  },
});

const dbPath = process.env.RELAYDESK_DB_PATH ?? path.join(process.cwd(), "data", "relaydesk.db");
const dir = process.env.RELAYDESK_BACKUP_DIR ?? path.join(path.dirname(dbPath), "backups");

let file = values.file;
if (values.latest) {
  file = listBackups(dir).at(-1);
  if (!file) throw new Error(`no backups in ${dir}`);
} else if (values["from-s3"]) {
  const target = s3FromEnv();
  if (!target) throw new Error("RELAYDESK_BACKUP_S3_* is not set");
  file = await downloadBackup(target, dir, positionals[0]);
  console.log(`Downloaded ${path.basename(file)}`);
}
if (!file) {
  console.error("Pick one: --latest, --file <path>, or --from-s3 [key]");
  process.exit(2);
}

if (!values.yes) {
  console.log(`Would restore ${file} over ${dbPath}.`);
  try {
    console.log(`Current database: ${JSON.stringify(summarize(dbPath))} (integrity: ${integrityOf(dbPath)})`);
  } catch {
    console.log("Current database: none or unreadable.");
  }
  console.log("Stop the app, then run again with --yes.");
  process.exit(0);
}

const result = await restoreBackup(file, dbPath);
console.log(`Restored ${path.basename(file)} to ${result.restored}.`);
if (result.keptAs) console.log(`The previous database is at ${result.keptAs}.`);
console.log(`Now holds: ${JSON.stringify(result.counts)}`);
