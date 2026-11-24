/**
 * One-time copy of the old SQLite database into Postgres (Neon), for the move off SQLite.
 *
 *   DATABASE_URL=postgres://... npx tsx scripts/sqlite-to-postgres.ts path/to/relaydesk.db          # counts only
 *   DATABASE_URL=postgres://... npx tsx scripts/sqlite-to-postgres.ts path/to/relaydesk.db --yes    # copy
 *
 * With --yes it creates the tables if needed, empties them, and copies every row, all in one
 * transaction, then checks the counts match. RUNBOOK.md → "Moving from SQLite" has the cutover steps.
 */
import { DatabaseSync } from "node:sqlite";
import pg from "pg";
import { closeDb, getBusiness } from "../src/lib/db";

const TABLES = [
  "businesses",
  "staff",
  "articles",
  "invites",
  "mcp_tokens",
  "business_settings",
  "conversations",
  "messages",
  "tickets",
  "agent_drafts",
  "agent_runs",
  "voice_usage",
  "settings",
];
const BATCH = 500;

async function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--"));
  const url = process.env.DATABASE_URL;
  if (!file || !url) {
    console.error("usage: DATABASE_URL=postgres://... npx tsx scripts/sqlite-to-postgres.ts <relaydesk.db> [--yes]");
    process.exit(1);
  }

  const sqlite = new DatabaseSync(file, { readOnly: true });
  const present = new Set(
    (sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name),
  );
  const tables = TABLES.filter((t) => present.has(t));
  const counts = Object.fromEntries(
    tables.map((t) => [t, (sqlite.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n]),
  );
  console.table(counts);
  if (!args.includes("--yes")) {
    console.log("Nothing copied. Run again with --yes to replace everything in DATABASE_URL with these rows.");
    return;
  }

  // Opening the app's database creates the tables (and seeds the demo, which the copy then replaces).
  await getBusiness("nimbus");
  await closeDb();

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(`TRUNCATE ${TABLES.join(", ")}`);
    for (const table of tables) {
      const rows = sqlite.prepare(`SELECT * FROM ${table}`).all() as Record<string, unknown>[];
      for (let start = 0; start < rows.length; start += BATCH) {
        const batch = rows.slice(start, start + BATCH);
        const columns = Object.keys(batch[0]);
        const params: unknown[] = [];
        const values = batch.map(
          (row) => `(${columns.map((c) => `$${params.push(row[c])}`).join(", ")})`,
        );
        await client.query(`INSERT INTO ${table} (${columns.join(", ")}) VALUES ${values.join(", ")}`, params);
      }
    }
    for (const table of tables) {
      const { rows } = await client.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM ${table}`);
      if (rows[0].n !== counts[table]) throw new Error(`${table}: copied ${rows[0].n}, expected ${counts[table]}`);
    }
    await client.query("COMMIT");
    console.log("Copied, and every table's count matches.");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
