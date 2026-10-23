import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { ARTICLES, type Article } from "@/lib/articles";
import { PENDING_TICKET_EMAIL } from "@/lib/escalate";
import { DEMO_BUSINESS_ID, DEMO_BUSINESS_NAME } from "@/lib/help-center";
import type {
  AgentDraft,
  AgentRun,
  Business,
  Conversation,
  Message,
  Staff,
  Ticket,
} from "@/lib/models";
import { hashPassword, verifyPassword } from "@/lib/passwords";

export type { AgentDraft, AgentRun, Business, Conversation, Message, Staff, Ticket };

/*
 * Every business's data lives in one database. Conversations and tickets carry
 * a business_id, and every read that starts from an id a browser sent takes the
 * business too, so a guessed id from another business comes back undefined.
 * Messages, drafts, and runs hang off those two and are reached through them.
 */

export const DEMO_STAFF_EMAIL = "staff@nimbus.demo";

export function demoStaffPassword(): string {
  return process.env.RELAYDESK_ADMIN_PASSWORD ?? "nimbus-demo";
}

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
    CREATE TABLE IF NOT EXISTS businesses (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      articles_version INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS staff (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS articles (
      business_id TEXT NOT NULL,
      slug TEXT NOT NULL,
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      summary TEXT NOT NULL,
      body TEXT NOT NULL,
      position INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (business_id, slug)
    );
    CREATE TABLE IF NOT EXISTS business_settings (
      business_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      PRIMARY KEY (business_id, key)
    );
    -- business_id defaults to the demo only so code from before businesses can still
    -- insert after a rollback (see RUNBOOK). Every insert here passes it explicitly.
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL DEFAULT '${DEMO_BUSINESS_ID}',
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
      business_id TEXT NOT NULL DEFAULT '${DEMO_BUSINESS_ID}',
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
    -- App-wide values, like the session signing secret. Per-business ones live in business_settings.
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  migrateTickets(db);
  migrateToBusinesses(db);
  db.exec(`
    CREATE INDEX IF NOT EXISTS tickets_by_business ON tickets (business_id, updated_at);
    CREATE INDEX IF NOT EXISTS conversations_by_business ON conversations (business_id);
  `);
  seedDemoBusiness(db);
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

/**
 * Databases from before businesses existed hold only Nimbus data. Their rows
 * get business_id "nimbus", and their co-pilot switch moves to Nimbus's settings.
 */
function migrateToBusinesses(db: Database.Database) {
  for (const table of ["conversations", "tickets"]) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (cols.some((col) => col.name === "business_id")) continue;
    db.exec(
      `ALTER TABLE ${table} ADD COLUMN business_id TEXT NOT NULL DEFAULT '${DEMO_BUSINESS_ID}'`,
    );
    if (table === "tickets") {
      db.prepare(
        `INSERT OR IGNORE INTO business_settings (business_id, key, value)
         SELECT ?, key, value FROM settings WHERE key = 'copilot'`,
      ).run(DEMO_BUSINESS_ID);
    }
  }
}

/** Nimbus, the demo business: its articles from code and one staff login. */
function seedDemoBusiness(db: Database.Database) {
  const now = new Date().toISOString();
  db.prepare(
    "INSERT OR IGNORE INTO businesses (id, name, created_at) VALUES (?, ?, ?)",
  ).run(DEMO_BUSINESS_ID, DEMO_BUSINESS_NAME, now);
  const articles = db
    .prepare("SELECT COUNT(*) AS n FROM articles WHERE business_id = ?")
    .get(DEMO_BUSINESS_ID) as { n: number };
  if (articles.n === 0) writeArticles(db, DEMO_BUSINESS_ID, ARTICLES);

  // The demo password comes from the environment, so re-hash when it changes.
  const password = demoStaffPassword();
  const staff = db
    .prepare("SELECT password_hash FROM staff WHERE email = ?")
    .get(DEMO_STAFF_EMAIL) as { password_hash: string } | undefined;
  if (!staff) {
    db.prepare(
      `INSERT INTO staff (id, business_id, email, name, password_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run("staff_nimbus_demo", DEMO_BUSINESS_ID, DEMO_STAFF_EMAIL, "You", hashPassword(password), now);
  } else if (!verifyPassword(password, staff.password_hash)) {
    db.prepare("UPDATE staff SET password_hash = ? WHERE email = ?").run(
      hashPassword(password),
      DEMO_STAFF_EMAIL,
    );
  }
}

function seedIfEmpty(db: Database.Database) {
  const count = db
    .prepare("SELECT COUNT(*) AS n FROM tickets WHERE business_id = ?")
    .get(DEMO_BUSINESS_ID) as { n: number };
  if (count.n > 0) return;

  const now = new Date();
  const earlier = new Date(now.getTime() - 1000 * 60 * 50).toISOString();
  const mid = new Date(now.getTime() - 1000 * 60 * 40).toISOString();
  const late = new Date(now.getTime() - 1000 * 60 * 12).toISOString();
  const iso = now.toISOString();

  const c1 = "conv_billing_seats";
  const c2 = "conv_sso_loop";
  const insertConversation = db.prepare(
    "INSERT INTO conversations (id, business_id, visitor_email, created_at) VALUES (?, ?, ?, ?)",
  );
  insertConversation.run(c1, DEMO_BUSINESS_ID, "priya@northline.io", earlier);
  insertConversation.run(c2, DEMO_BUSINESS_ID, "owen@harborapps.com", earlier);

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
    `INSERT INTO tickets (id, business_id, conversation_id, email, status, preview, created_at, updated_at, assignee)
     VALUES (?, '${DEMO_BUSINESS_ID}', ?, ?, ?, ?, ?, ?, ?)`,
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

export function createConversation(businessId: string, email?: string | null): Conversation {
  const row: Conversation = {
    id: crypto.randomUUID(),
    business_id: businessId,
    visitor_email: email ?? null,
    created_at: new Date().toISOString(),
  };
  db()
    .prepare(
      "INSERT INTO conversations (id, business_id, visitor_email, created_at) VALUES (?, ?, ?, ?)",
    )
    .run(row.id, row.business_id, row.visitor_email, row.created_at);
  return row;
}

export function getConversation(businessId: string, id: string): Conversation | undefined {
  return db()
    .prepare("SELECT * FROM conversations WHERE id = ? AND business_id = ?")
    .get(id, businessId) as Conversation | undefined;
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

/** Opens (or updates the email on) the ticket for a conversation the caller already scoped. */
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
      return getTicket(existing.business_id, existing.id) ?? existing;
    }
    return existing;
  }

  const conversation = db()
    .prepare("SELECT business_id FROM conversations WHERE id = ?")
    .get(conversationId) as { business_id: string } | undefined;
  if (!conversation) throw new Error(`no conversation ${conversationId}`);
  const last = db()
    .prepare(
      "SELECT body FROM messages WHERE conversation_id = ? AND role = 'visitor' ORDER BY created_at DESC LIMIT 1",
    )
    .get(conversationId) as { body: string } | undefined;
  const now = new Date().toISOString();
  const row: Ticket = {
    id: `tkt_${crypto.randomUUID().slice(0, 8)}`,
    business_id: conversation.business_id,
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
      `INSERT INTO tickets (id, business_id, conversation_id, email, status, preview, created_at, updated_at, assignee)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.id,
      row.business_id,
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

export function listTickets(businessId: string): Ticket[] {
  return db()
    .prepare(
      `SELECT t.*, EXISTS(
         SELECT 1 FROM agent_drafts d WHERE d.ticket_id = t.id AND d.status = 'pending'
       ) AS has_draft
       FROM tickets t WHERE t.business_id = ? ORDER BY t.updated_at DESC`,
    )
    .all(businessId) as Ticket[];
}

export function getTicket(businessId: string, id: string): Ticket | undefined {
  return db()
    .prepare("SELECT * FROM tickets WHERE id = ? AND business_id = ?")
    .get(id, businessId) as Ticket | undefined;
}

export function getTicketByConversation(conversationId: string): Ticket | undefined {
  return db()
    .prepare("SELECT * FROM tickets WHERE conversation_id = ?")
    .get(conversationId) as Ticket | undefined;
}

export function replyToTicket(businessId: string, id: string, body: string): Ticket | undefined {
  const ticket = getTicket(businessId, id);
  if (!ticket) return undefined;
  addMessage(ticket.conversation_id, "agent", body);
  const now = new Date().toISOString();
  // A person answered, so the "needs a human" flag is settled.
  db()
    .prepare(
      "UPDATE tickets SET status = 'waiting', assignee = COALESCE(assignee, 'You'), needs_human_reason = NULL, updated_at = ? WHERE id = ?",
    )
    .run(now, id);
  return getTicket(businessId, id);
}

export function updateTicket(
  businessId: string,
  id: string,
  patch: { status?: Ticket["status"]; assignee?: string | null },
): Ticket | undefined {
  const ticket = getTicket(businessId, id);
  if (!ticket) return undefined;
  const status = patch.status ?? ticket.status;
  const assignee = patch.assignee === undefined ? ticket.assignee : patch.assignee;
  const now = new Date().toISOString();
  db()
    .prepare(
      "UPDATE tickets SET status = ?, assignee = ?, updated_at = ? WHERE id = ?",
    )
    .run(status, assignee, now, id);
  return getTicket(businessId, id);
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

export function getDraft(businessId: string, id: string): AgentDraft | undefined {
  return db()
    .prepare(
      `SELECT d.* FROM agent_drafts d JOIN tickets t ON t.id = d.ticket_id
       WHERE d.id = ? AND t.business_id = ?`,
    )
    .get(id, businessId) as AgentDraft | undefined;
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

export function getSetting(businessId: string, key: string): string | undefined {
  const row = db()
    .prepare("SELECT value FROM business_settings WHERE business_id = ? AND key = ?")
    .get(businessId, key) as { value: string } | undefined;
  return row?.value;
}

export function setSetting(businessId: string, key: string, value: string) {
  db()
    .prepare(
      `INSERT INTO business_settings (business_id, key, value) VALUES (?, ?, ?)
       ON CONFLICT(business_id, key) DO UPDATE SET value = excluded.value`,
    )
    .run(businessId, key, value);
}

/** Signs staff sessions. RELAYDESK_SESSION_SECRET wins; otherwise one is made once and kept here. */
export function sessionSecret(): string {
  const fromEnv = process.env.RELAYDESK_SESSION_SECRET;
  if (fromEnv) return fromEnv;
  db()
    .prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('session_secret', ?)")
    .run(randomBytes(32).toString("base64url"));
  const row = db().prepare("SELECT value FROM settings WHERE key = 'session_secret'").get() as {
    value: string;
  };
  return row.value;
}

// Businesses, their staff, and their articles.

export const BUSINESS_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

export function getBusiness(id: string): Business | undefined {
  return db().prepare("SELECT * FROM businesses WHERE id = ?").get(id) as Business | undefined;
}

export function createBusiness(business: { id: string; name: string }): Business {
  if (!BUSINESS_ID_PATTERN.test(business.id)) {
    throw new Error(
      `business id "${business.id}" must be lowercase letters, digits, and dashes (2-40 chars)`,
    );
  }
  const row: Business = {
    id: business.id,
    name: business.name.trim(),
    articles_version: 0,
    created_at: new Date().toISOString(),
  };
  db()
    .prepare(
      "INSERT INTO businesses (id, name, articles_version, created_at) VALUES (?, ?, ?, ?)",
    )
    .run(row.id, row.name, row.articles_version, row.created_at);
  return row;
}

export function listArticles(businessId: string): Article[] {
  return db()
    .prepare(
      `SELECT slug, title, category, summary, body FROM articles
       WHERE business_id = ? ORDER BY position, slug`,
    )
    .all(businessId) as Article[];
}

function writeArticles(conn: Database.Database, businessId: string, articles: Article[]) {
  const now = new Date().toISOString();
  const write = conn.transaction(() => {
    conn.prepare("DELETE FROM articles WHERE business_id = ?").run(businessId);
    const insert = conn.prepare(
      `INSERT INTO articles (business_id, slug, title, category, summary, body, position, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    articles.forEach((a, position) =>
      insert.run(businessId, a.slug, a.title, a.category, a.summary, a.body, position, now),
    );
    conn
      .prepare("UPDATE businesses SET articles_version = articles_version + 1 WHERE id = ?")
      .run(businessId);
  });
  write();
}

/** Replaces the business's whole help center; the answer graph picks it up on the next chat. */
export function replaceArticles(businessId: string, articles: Article[]) {
  writeArticles(db(), businessId, articles);
}

export function createStaff(staff: {
  businessId: string;
  email: string;
  name: string;
  password: string;
}): Staff {
  const row: Staff = {
    id: `staff_${crypto.randomUUID().slice(0, 8)}`,
    business_id: staff.businessId,
    email: staff.email.trim().toLowerCase(),
    name: staff.name.trim(),
    created_at: new Date().toISOString(),
  };
  db()
    .prepare(
      `INSERT INTO staff (id, business_id, email, name, password_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(row.id, row.business_id, row.email, row.name, hashPassword(staff.password), row.created_at);
  return row;
}

export function getStaff(businessId: string, id: string): Staff | undefined {
  return db()
    .prepare(
      "SELECT id, business_id, email, name, created_at FROM staff WHERE id = ? AND business_id = ?",
    )
    .get(id, businessId) as Staff | undefined;
}

const UNKNOWN_EMAIL_HASH = hashPassword(randomBytes(16).toString("base64url"));

/** The staff member for this email and password, or undefined. */
export function checkStaffLogin(email: string, password: string): Staff | undefined {
  const normalized = email.trim().toLowerCase();
  const hash = db()
    .prepare("SELECT password_hash FROM staff WHERE email = ?")
    .get(normalized) as { password_hash: string } | undefined;
  // Unknown emails still pay for one scrypt, so response time doesn't say which emails exist.
  const ok = verifyPassword(password, hash?.password_hash ?? UNKNOWN_EMAIL_HASH);
  if (!hash || !ok) return undefined;
  return db()
    .prepare("SELECT id, business_id, email, name, created_at FROM staff WHERE email = ?")
    .get(normalized) as Staff;
}
