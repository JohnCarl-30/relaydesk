import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { PENDING_TICKET_EMAIL } from "@/lib/escalate";
import type { AgentDraft, AgentRun, Conversation, Message, Ticket } from "@/lib/models";

export type { AgentDraft, AgentRun, Conversation, Message, Ticket };

type GlobalDb = typeof globalThis & { __relaydeskDb?: Database.Database };

function open(): Database.Database {
  const g = globalThis as GlobalDb;
  if (g.__relaydeskDb) return g.__relaydeskDb;

  const file =
    process.env.RELAYDESK_DB_PATH ?? path.join(process.cwd(), "data", "relaydesk.db");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      visitor_email TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      body TEXT NOT NULL,
      citations TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tickets (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      email TEXT NOT NULL,
      status TEXT NOT NULL,
      preview TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      assignee TEXT
    );
    CREATE TABLE IF NOT EXISTS agent_drafts (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      body TEXT NOT NULL,
      citations TEXT,
      rationale TEXT NOT NULL,
      based_on_message_id TEXT,
      status TEXT NOT NULL,
      final_body TEXT,
      reject_reason TEXT,
      model TEXT NOT NULL,
      prompt_version TEXT NOT NULL,
      created_at TEXT NOT NULL,
      decided_at TEXT
    );
    CREATE TABLE IF NOT EXISTS agent_runs (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL,
      trigger TEXT NOT NULL,
      outcome TEXT NOT NULL,
      detail TEXT,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  migrateTickets(db);
  seedIfEmpty(db);
  g.__relaydeskDb = db;
  return db;
}

function migrateTickets(db: Database.Database) {
  const cols = db.prepare("PRAGMA table_info(tickets)").all() as { name: string }[];
  for (const column of ["assignee", "topic", "summary", "needs_human_reason"]) {
    if (!cols.some((col) => col.name === column)) {
      db.exec(`ALTER TABLE tickets ADD COLUMN ${column} TEXT`);
    }
  }
}

function seedIfEmpty(db: Database.Database) {
  const count = db.prepare("SELECT COUNT(*) AS n FROM tickets").get() as { n: number };
  if (count.n > 0) return;

  const now = new Date();
  const earlier = new Date(now.getTime() - 1000 * 60 * 50).toISOString();
  const mid = new Date(now.getTime() - 1000 * 60 * 40).toISOString();
  const late = new Date(now.getTime() - 1000 * 60 * 12).toISOString();
  const iso = now.toISOString();

  const c1 = "conv_billing_seats";
  const c2 = "conv_sso_loop";
  db.prepare(
    "INSERT INTO conversations (id, visitor_email, created_at) VALUES (?, ?, ?)",
  ).run(c1, "priya@northline.io", earlier);
  db.prepare(
    "INSERT INTO conversations (id, visitor_email, created_at) VALUES (?, ?, ?)",
  ).run(c2, "owen@harborapps.com", earlier);

  const insertMsg = db.prepare(
    `INSERT INTO messages (id, conversation_id, role, body, citations, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  insertMsg.run(
    "m1",
    c1,
    "visitor",
    "Our invoice shows 12 seats but we only have 9 people who can log in. Two left last week.",
    null,
    earlier,
  );
  insertMsg.run(
    "m2",
    c1,
    "assistant",
    "Seat count on the invoice is a snapshot from the last day of the billing period. If someone left mid-cycle they can still appear on that invoice. Pending invites do not count until they accept.",
    JSON.stringify(["How billing works: seats and the invoice"]),
    mid,
  );
  insertMsg.run(
    "m3",
    c1,
    "visitor",
    "That doesn't match what sales told us. I need a human.",
    null,
    late,
  );

  insertMsg.run(
    "m4",
    c2,
    "visitor",
    "SSO keeps bouncing me back to Google and I never land in Nimbus.",
    null,
    earlier,
  );
  insertMsg.run(
    "m5",
    c2,
    "assistant",
    "If SSO loops, check that the ACS URL has no trailing slash and that the user already exists as a Nimbus member. JIT provisioning is off by default.",
    JSON.stringify(["Set up Google or Okta SSO"]),
    mid,
  );
  insertMsg.run(
    "m6",
    c2,
    "agent",
    "I checked your workspace. JIT is off and owen@harborapps.com was never invited. I sent a viewer invite. After you accept it, Google SSO will let you in.",
    null,
    late,
  );

  const insertTicket = db.prepare(
    `INSERT INTO tickets (id, conversation_id, email, status, preview, created_at, updated_at, assignee)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  insertTicket.run(
    "tkt_seats",
    c1,
    "priya@northline.io",
    "open",
    "Invoice shows 12 seats but we only have 9 people",
    late,
    late,
    null,
  );
  insertTicket.run(
    "tkt_sso",
    c2,
    "owen@harborapps.com",
    "waiting",
    "SSO keeps bouncing me back to Google",
    late,
    iso,
    "You",
  );
}

export function db() {
  return open();
}

export function createConversation(email?: string | null): Conversation {
  const row: Conversation = {
    id: crypto.randomUUID(),
    visitor_email: email ?? null,
    created_at: new Date().toISOString(),
  };
  db()
    .prepare(
      "INSERT INTO conversations (id, visitor_email, created_at) VALUES (?, ?, ?)",
    )
    .run(row.id, row.visitor_email, row.created_at);
  return row;
}

export function getConversation(id: string): Conversation | undefined {
  return db()
    .prepare("SELECT * FROM conversations WHERE id = ?")
    .get(id) as Conversation | undefined;
}

export function setConversationEmail(id: string, email: string) {
  db().prepare("UPDATE conversations SET visitor_email = ? WHERE id = ?").run(email, id);
}

export function addMessage(
  conversationId: string,
  role: Message["role"],
  body: string,
  citations?: string[],
): Message {
  const row: Message = {
    id: crypto.randomUUID(),
    conversation_id: conversationId,
    role,
    body,
    citations: citations?.length ? JSON.stringify(citations) : null,
    created_at: new Date().toISOString(),
  };
  db()
    .prepare(
      `INSERT INTO messages (id, conversation_id, role, body, citations, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(row.id, row.conversation_id, row.role, row.body, row.citations, row.created_at);
  return row;
}

export function listMessages(conversationId: string): Message[] {
  return db()
    .prepare(
      "SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC",
    )
    .all(conversationId) as Message[];
}

export function createTicket(conversationId: string, email: string): Ticket {
  const existing = db()
    .prepare("SELECT * FROM tickets WHERE conversation_id = ?")
    .get(conversationId) as Ticket | undefined;
  const nextEmail = email.trim().toLowerCase();
  const realEmail = nextEmail.includes("@") && nextEmail !== PENDING_TICKET_EMAIL;
  if (existing) {
    if (realEmail) {
      const now = new Date().toISOString();
      db()
        .prepare("UPDATE tickets SET email = ?, updated_at = ? WHERE id = ?")
        .run(nextEmail, now, existing.id);
      setConversationEmail(conversationId, nextEmail);
      return getTicket(existing.id) ?? existing;
    }
    return existing;
  }

  const last = db()
    .prepare(
      "SELECT body FROM messages WHERE conversation_id = ? AND role = 'visitor' ORDER BY created_at DESC LIMIT 1",
    )
    .get(conversationId) as { body: string } | undefined;
  const now = new Date().toISOString();
  const row: Ticket = {
    id: `tkt_${crypto.randomUUID().slice(0, 8)}`,
    conversation_id: conversationId,
    email: nextEmail,
    status: "open",
    assignee: null,
    preview: (last?.body ?? "New conversation").slice(0, 140),
    created_at: now,
    updated_at: now,
    topic: null,
    summary: null,
    needs_human_reason: null,
  };
  db()
    .prepare(
      `INSERT INTO tickets (id, conversation_id, email, status, preview, created_at, updated_at, assignee)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.id,
      row.conversation_id,
      row.email,
      row.status,
      row.preview,
      row.created_at,
      row.updated_at,
      row.assignee,
    );
  setConversationEmail(conversationId, nextEmail);
  return row;
}

export function listTickets(): Ticket[] {
  return db()
    .prepare(
      `SELECT t.*, EXISTS(
         SELECT 1 FROM agent_drafts d WHERE d.ticket_id = t.id AND d.status = 'pending'
       ) AS has_draft
       FROM tickets t ORDER BY t.updated_at DESC`,
    )
    .all() as Ticket[];
}

export function getTicket(id: string): Ticket | undefined {
  return db().prepare("SELECT * FROM tickets WHERE id = ?").get(id) as
    | Ticket
    | undefined;
}

export function getTicketByConversation(conversationId: string): Ticket | undefined {
  return db()
    .prepare("SELECT * FROM tickets WHERE conversation_id = ?")
    .get(conversationId) as Ticket | undefined;
}

export function replyToTicket(id: string, body: string): Ticket | undefined {
  const ticket = getTicket(id);
  if (!ticket) return undefined;
  addMessage(ticket.conversation_id, "agent", body);
  const now = new Date().toISOString();
  // A person answered, so the "needs a human" flag is settled.
  db()
    .prepare(
      "UPDATE tickets SET status = 'waiting', assignee = COALESCE(assignee, 'You'), needs_human_reason = NULL, updated_at = ? WHERE id = ?",
    )
    .run(now, id);
  return getTicket(id);
}

export function updateTicket(
  id: string,
  patch: { status?: Ticket["status"]; assignee?: string | null },
): Ticket | undefined {
  const ticket = getTicket(id);
  if (!ticket) return undefined;
  const status = patch.status ?? ticket.status;
  const assignee = patch.assignee === undefined ? ticket.assignee : patch.assignee;
  const now = new Date().toISOString();
  db()
    .prepare(
      "UPDATE tickets SET status = ?, assignee = ?, updated_at = ? WHERE id = ?",
    )
    .run(status, assignee, now, id);
  return getTicket(id);
}

export function setTicketTriage(
  id: string,
  triage: { topic: string; summary: string; needsHumanReason: string | null },
) {
  db()
    .prepare("UPDATE tickets SET topic = ?, summary = ?, needs_human_reason = ? WHERE id = ?")
    .run(triage.topic, triage.summary, triage.needsHumanReason, id);
}

/** Saves a pending draft and supersedes any earlier pending draft for the ticket. */
export function insertDraft(
  draft: Omit<AgentDraft, "id" | "status" | "final_body" | "reject_reason" | "created_at" | "decided_at">,
): AgentDraft {
  const row: AgentDraft = {
    ...draft,
    id: `drf_${crypto.randomUUID().slice(0, 8)}`,
    status: "pending",
    final_body: null,
    reject_reason: null,
    created_at: new Date().toISOString(),
    decided_at: null,
  };
  const write = db().transaction(() => {
    db()
      .prepare(
        "UPDATE agent_drafts SET status = 'superseded', decided_at = ? WHERE ticket_id = ? AND status = 'pending'",
      )
      .run(row.created_at, row.ticket_id);
    db()
      .prepare(
        `INSERT INTO agent_drafts (id, ticket_id, kind, body, citations, rationale, based_on_message_id,
           status, final_body, reject_reason, model, prompt_version, created_at, decided_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id, row.ticket_id, row.kind, row.body, row.citations, row.rationale,
        row.based_on_message_id, row.status, row.final_body, row.reject_reason,
        row.model, row.prompt_version, row.created_at, row.decided_at,
      );
  });
  write();
  return row;
}

export function getPendingDraft(ticketId: string): AgentDraft | undefined {
  return db()
    .prepare(
      "SELECT * FROM agent_drafts WHERE ticket_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1",
    )
    .get(ticketId) as AgentDraft | undefined;
}

export function getDraft(id: string): AgentDraft | undefined {
  return db().prepare("SELECT * FROM agent_drafts WHERE id = ?").get(id) as
    | AgentDraft
    | undefined;
}

export function decideDraft(
  id: string,
  decision: { status: "sent" | "edited" | "rejected"; finalBody?: string; rejectReason?: string },
) {
  db()
    .prepare(
      "UPDATE agent_drafts SET status = ?, final_body = ?, reject_reason = ?, decided_at = ? WHERE id = ?",
    )
    .run(
      decision.status,
      decision.finalBody ?? null,
      decision.rejectReason ?? null,
      new Date().toISOString(),
      id,
    );
}

export function recordRun(run: Omit<AgentRun, "id" | "created_at">): AgentRun {
  const row: AgentRun = {
    ...run,
    id: `run_${crypto.randomUUID().slice(0, 8)}`,
    created_at: new Date().toISOString(),
  };
  db()
    .prepare(
      `INSERT INTO agent_runs (id, ticket_id, trigger, outcome, detail, input_tokens, output_tokens, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.id, row.ticket_id, row.trigger, row.outcome, row.detail,
      row.input_tokens, row.output_tokens, row.created_at,
    );
  return row;
}

export function listRuns(ticketId: string, limit = 5): AgentRun[] {
  return db()
    .prepare("SELECT * FROM agent_runs WHERE ticket_id = ? ORDER BY created_at DESC LIMIT ?")
    .all(ticketId, limit) as AgentRun[];
}

export function countRunsSince(ticketId: string, sinceIso: string): number {
  const row = db()
    .prepare("SELECT COUNT(*) AS n FROM agent_runs WHERE ticket_id = ? AND created_at >= ?")
    .get(ticketId, sinceIso) as { n: number };
  return row.n;
}

export function getSetting(key: string): string | undefined {
  const row = db().prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value;
}

export function setSetting(key: string, value: string) {
  db()
    .prepare(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .run(key, value);
}
