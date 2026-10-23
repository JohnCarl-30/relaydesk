import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { DEMO_BUSINESS_ID } from "./help-center";

const file = join(tmpdir(), `relaydesk-migrate-${process.pid}-${Date.now()}.db`);

// The schema main shipped before businesses existed, with one Nimbus ticket and the co-pilot off.
const legacy = new Database(file);
legacy.exec(`
  CREATE TABLE conversations (id TEXT PRIMARY KEY, visitor_email TEXT, created_at TEXT NOT NULL);
  CREATE TABLE messages (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, role TEXT NOT NULL,
    body TEXT NOT NULL, citations TEXT, created_at TEXT NOT NULL);
  CREATE TABLE tickets (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, email TEXT NOT NULL,
    status TEXT NOT NULL, preview TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    assignee TEXT, topic TEXT, summary TEXT, needs_human_reason TEXT);
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  INSERT INTO conversations VALUES ('conv_old', 'old@example.com', '2026-10-01T00:00:00.000Z');
  INSERT INTO tickets (id, conversation_id, email, status, preview, created_at, updated_at)
    VALUES ('tkt_old', 'conv_old', 'old@example.com', 'open', 'old ticket',
      '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z');
  INSERT INTO settings VALUES ('copilot', 'off');
`);
legacy.close();
process.env.RELAYDESK_DB_PATH = file;

describe("opening a database from before businesses", () => {
  it("files existing rows under Nimbus and keeps its co-pilot switch", async () => {
    const db = await import("./db");
    const { copilotEnabled } = await import("./copilot");
    assert.equal(db.getTicket(DEMO_BUSINESS_ID, "tkt_old")?.preview, "old ticket");
    assert.equal(db.getConversation(DEMO_BUSINESS_ID, "conv_old")?.visitor_email, "old@example.com");
    assert.equal(copilotEnabled(DEMO_BUSINESS_ID), false);
    assert.equal(db.getBusiness(DEMO_BUSINESS_ID)?.name, "Nimbus");
    assert.ok(db.listArticles(DEMO_BUSINESS_ID).length > 0);
  });
});
