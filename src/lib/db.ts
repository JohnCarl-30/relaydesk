import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ARTICLES, type Article } from "@/lib/articles";
import { PENDING_TICKET_EMAIL } from "@/lib/escalate";
import { DEMO_BUSINESS_ID, DEMO_BUSINESS_NAME } from "@/lib/help-center";
import type {
  AgentDraft,
  AgentRun,
  Business,
  Conversation,
  Invite,
  McpToken,
  Message,
  Staff,
  Ticket,
} from "@/lib/models";
import { hashPassword, verifyPassword } from "@/lib/passwords";
import { SESSION_TTL_MS } from "@/lib/session";

export type {
  AgentDraft,
  AgentRun,
  Business,
  Conversation,
  Invite,
  McpToken,
  Message,
  Staff,
  Ticket,
};

/*
 * Every business's data lives in one database. Conversations and tickets carry
 * a business_id, and every read that starts from an id a browser sent takes the
 * business too, so a guessed id from another business comes back undefined.
 * Messages, drafts, and runs hang off those two and are reached through them.
 */

export const DEMO_STAFF_EMAIL = "staff@nimbus.demo";

/** Printed on /login and /demo, so anyone can sign in with it. */
export const PUBLIC_DEMO_PASSWORD = "nimbus-demo";

export function demoStaffPassword(): string {
  return process.env.RELAYDESK_ADMIN_PASSWORD ?? PUBLIC_DEMO_PASSWORD;
}

const DEMO_PASSWORD_CHANGED_AT = "demo_password_changed_at";

/**
 * True for a Nimbus session started before the demo password last changed. It may have been started
 * with the password printed on /login, so it must not gain setup access once that password is gone.
 */
export async function demoSessionRevoked(session: { businessId: string; expiresAt: number }): Promise<boolean> {
  if (session.businessId !== DEMO_BUSINESS_ID) return false;
  const row = await get<{ value: string }>("SELECT value FROM settings WHERE key = ?", DEMO_PASSWORD_CHANGED_AT);
  return session.expiresAt - SESSION_TTL_MS < Number(row?.value ?? 0);
}

const signedOutKey = (staffId: string) => `signed_out_at:${staffId}`;

/** Signing out stamps the time, so a cookie started before it (a copy, another device) stops working too. */
export async function recordSignOut(staff: { id: string; business_id: string }, now = Date.now()) {
  await setSetting(staff.business_id, signedOutKey(staff.id), String(now));
}

export async function signedOutSince(session: { staffId: string; businessId: string; expiresAt: number }): Promise<boolean> {
  const at = await getSetting(session.businessId, signedOutKey(session.staffId));
  return session.expiresAt - SESSION_TTL_MS < Number(at ?? 0);
}

/** True for Nimbus staff while the login still takes the printed password: they can work tickets but not change setup. */
export function isPublicDemo(staff: { business_id: string }): boolean {
  return staff.business_id === DEMO_BUSINESS_ID && demoStaffPassword() === PUBLIC_DEMO_PASSWORD;
}

// Connection. Neon (or any Postgres) when DATABASE_URL is set; otherwise PGlite on disk, for dev and tests.

type Conn = {
  query(text: string, params: unknown[]): Promise<{ rows: Record<string, unknown>[]; count: number }>;
  /** Several statements, no parameters. */
  exec(text: string): Promise<void>;
  tx<T>(fn: (conn: Conn) => Promise<T>): Promise<T>;
  close(): Promise<void>;
};

async function connect(): Promise<Conn> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: url });
    const wrap =
      (c: Pick<import("pg").PoolClient, "query">): Conn["query"] =>
      async (text, params) => {
        const r = await c.query(text, params);
        return { rows: r.rows, count: r.rowCount ?? 0 };
      };
    const conn: Conn = {
      query: wrap(pool),
      exec: async (text) => void (await pool.query(text)),
      async tx(fn) {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const out = await fn({ ...conn, query: wrap(client), exec: async (text) => void (await client.query(text)) });
          await client.query("COMMIT");
          return out;
        } catch (err) {
          await client.query("ROLLBACK");
          throw err;
        } finally {
          client.release();
        }
      },
      close: () => pool.end(),
    };
    return conn;
  }

  const { PGlite } = await import("@electric-sql/pglite");
  const dir = process.env.RELAYDESK_DB_PATH ?? path.join(process.cwd(), "data", "pglite");
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  const pg = await PGlite.create(dir);
  const wrap =
    (c: Pick<typeof pg, "query">): Conn["query"] =>
    async (text, params) => {
      const r = await c.query<Record<string, unknown>>(text, params);
      return { rows: r.rows, count: r.affectedRows ?? 0 };
    };
  const conn: Conn = {
    query: wrap(pg),
    exec: async (text) => void (await pg.exec(text)),
    tx: (fn) => pg.transaction((t) => fn({ ...conn, query: wrap(t), exec: async (text) => void (await t.exec(text)) })),
    close: () => pg.close(),
  };
  return conn;
}

/** The transaction the current call is inside, if any, so nested calls join it. */
const inTx = new AsyncLocalStorage<Conn>();
type GlobalDb = typeof globalThis & { __relaydeskDb?: Promise<Conn> };

function open(): Promise<Conn> {
  const g = globalThis as GlobalDb;
  g.__relaydeskDb ??= connect().then(async (conn) => {
    await conn.tx((t) => inTx.run(t, setUp));
    return conn;
  });
  return g.__relaydeskDb;
}

/** Closes the connection. The next query opens it again and re-runs the setup, as a restart would. */
export async function closeDb() {
  const g = globalThis as GlobalDb;
  const conn = g.__relaydeskDb;
  delete g.__relaydeskDb;
  await (await conn)?.close();
}

// shortcut: `?` placeholders become $1, $2…, so SQL here can't contain a literal question mark.
async function query(text: string, params: unknown[]) {
  let i = 0;
  const conn = inTx.getStore() ?? (await open());
  return conn.query(text.replace(/\?/g, () => `$${++i}`), params);
}

async function get<T>(text: string, ...params: unknown[]): Promise<T | undefined> {
  return (await query(text, params)).rows[0] as T | undefined;
}

async function all<T>(text: string, ...params: unknown[]): Promise<T[]> {
  return (await query(text, params)).rows as T[];
}

/** Runs a write and returns how many rows it changed. */
async function run(text: string, ...params: unknown[]): Promise<number> {
  return (await query(text, params)).count;
}

/** Runs fn in one transaction. Calls inside it, nested ones too, join it. */
async function transaction<T>(fn: () => Promise<T>): Promise<T> {
  if (inTx.getStore()) return fn();
  return (await open()).tx((t) => inTx.run(t, fn));
}

async function setUp() {
  await inTx.getStore()!.exec(`
    CREATE TABLE IF NOT EXISTS businesses (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      articles_version INTEGER NOT NULL DEFAULT 0,
      -- 0 until the business goes live: its help center, widget, and chat API stay hidden.
      live INTEGER NOT NULL DEFAULT 1,
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
    CREATE TABLE IF NOT EXISTS invites (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL,
      email TEXT NOT NULL,
      -- sha256 of the token in the link; the token itself is shown once and never stored.
      token_hash TEXT NOT NULL UNIQUE,
      invited_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      accepted_at TEXT
    );
    CREATE TABLE IF NOT EXISTS mcp_tokens (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL,
      name TEXT NOT NULL,
      -- sha256 of the bearer token; the token is shown once when created.
      token_hash TEXT NOT NULL UNIQUE,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_used_at TEXT
    );
    CREATE TABLE IF NOT EXISTS business_settings (
      business_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      PRIMARY KEY (business_id, key)
    );
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL,
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
      business_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      email TEXT NOT NULL,
      status TEXT NOT NULL,
      preview TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      assignee TEXT,
      topic TEXT,
      summary TEXT,
      needs_human_reason TEXT,
      intent TEXT,
      intent_reason TEXT
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
    -- Seconds of ElevenLabs speech, in and out, per business per calendar month (UTC).
    CREATE TABLE IF NOT EXISTS voice_usage (
      business_id TEXT NOT NULL,
      month TEXT NOT NULL,
      seconds DOUBLE PRECISION NOT NULL DEFAULT 0,
      PRIMARY KEY (business_id, month)
    );
    -- App-wide values, like the session signing secret. Per-business ones live in business_settings.
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS tickets_by_business ON tickets (business_id, updated_at);
    CREATE INDEX IF NOT EXISTS conversations_by_business ON conversations (business_id);
    CREATE INDEX IF NOT EXISTS messages_by_conversation ON messages (conversation_id, created_at);
    CREATE INDEX IF NOT EXISTS tickets_by_conversation ON tickets (conversation_id);
    CREATE INDEX IF NOT EXISTS drafts_by_ticket ON agent_drafts (ticket_id, status);
  `);
  await seedDemoBusiness();
  await seedIfEmpty();
}

/** Nimbus, the demo business: its articles from code and one staff login. */
async function seedDemoBusiness() {
  const now = new Date().toISOString();
  await run(
    "INSERT INTO businesses (id, name, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
    DEMO_BUSINESS_ID,
    DEMO_BUSINESS_NAME,
    now,
  );
  const articles = await get<{ n: number }>(
    "SELECT COUNT(*)::int AS n FROM articles WHERE business_id = ?",
    DEMO_BUSINESS_ID,
  );
  if (!articles?.n) await replaceArticles(DEMO_BUSINESS_ID, ARTICLES);

  // The demo password comes from the environment, so re-hash when it changes.
  const password = demoStaffPassword();
  const staff = await get<{ password_hash: string }>(
    "SELECT password_hash FROM staff WHERE email = ?",
    DEMO_STAFF_EMAIL,
  );
  if (!staff) {
    await run(
      `INSERT INTO staff (id, business_id, email, name, password_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      "staff_nimbus_demo", DEMO_BUSINESS_ID, DEMO_STAFF_EMAIL, "You", hashPassword(password), now,
    );
  } else if (!verifyPassword(password, staff.password_hash)) {
    await run("UPDATE staff SET password_hash = ? WHERE email = ?", hashPassword(password), DEMO_STAFF_EMAIL);
    await run(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      DEMO_PASSWORD_CHANGED_AT,
      String(Date.now()),
    );
  }
}

async function seedIfEmpty() {
  const count = await get<{ n: number }>(
    "SELECT COUNT(*)::int AS n FROM tickets WHERE business_id = ?",
    DEMO_BUSINESS_ID,
  );
  if (count?.n) return;

  const now = new Date();
  const earlier = new Date(now.getTime() - 1000 * 60 * 50).toISOString();
  const mid = new Date(now.getTime() - 1000 * 60 * 40).toISOString();
  const late = new Date(now.getTime() - 1000 * 60 * 12).toISOString();
  const iso = now.toISOString();

  const c1 = "conv_billing_seats";
  const c2 = "conv_sso_loop";
  const insertConversation = (id: string, email: string) =>
    run(
      "INSERT INTO conversations (id, business_id, visitor_email, created_at) VALUES (?, ?, ?, ?)",
      id, DEMO_BUSINESS_ID, email, earlier,
    );
  await insertConversation(c1, "priya@northline.io");
  await insertConversation(c2, "owen@harborapps.com");

  const insertMsg = (id: string, conv: string, role: string, body: string, citations: string | null, at: string) =>
    run(
      `INSERT INTO messages (id, conversation_id, role, body, citations, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      id, conv, role, body, citations, at,
    );
  await insertMsg(
    "m1",
    c1,
    "visitor",
    "Our invoice shows 12 seats but we only have 9 people who can log in. Two left last week.",
    null,
    earlier,
  );
  await insertMsg(
    "m2",
    c1,
    "assistant",
    "Seat count on the invoice is a snapshot from the last day of the billing period. If someone left mid-cycle they can still appear on that invoice. Pending invites do not count until they accept.",
    JSON.stringify(["How billing works: seats and the invoice"]),
    mid,
  );
  await insertMsg("m3", c1, "visitor", "That doesn't match what sales told us. I need a human.", null, late);

  await insertMsg("m4", c2, "visitor", "SSO keeps bouncing me back to Google and I never land in Nimbus.", null, earlier);
  await insertMsg(
    "m5",
    c2,
    "assistant",
    "If SSO loops, check that the ACS URL has no trailing slash and that the user already exists as a Nimbus member. JIT provisioning is off by default.",
    JSON.stringify(["Set up Google or Okta SSO"]),
    mid,
  );
  await insertMsg(
    "m6",
    c2,
    "agent",
    "I checked your workspace. JIT is off and owen@harborapps.com was never invited. I sent a viewer invite. After you accept it, Google SSO will let you in.",
    null,
    late,
  );

  const insertTicket = (...values: unknown[]) =>
    run(
      `INSERT INTO tickets (id, business_id, conversation_id, email, status, preview, created_at, updated_at, assignee)
       VALUES (?, '${DEMO_BUSINESS_ID}', ?, ?, ?, ?, ?, ?, ?)`,
      ...values,
    );
  await insertTicket("tkt_seats", c1, "priya@northline.io", "open", "Invoice shows 12 seats but we only have 9 people", late, late, null);
  await insertTicket("tkt_sso", c2, "owen@harborapps.com", "waiting", "SSO keeps bouncing me back to Google", late, iso, "You");
}

export async function createConversation(businessId: string, email?: string | null): Promise<Conversation> {
  const row: Conversation = {
    id: crypto.randomUUID(),
    business_id: businessId,
    visitor_email: email ?? null,
    created_at: new Date().toISOString(),
  };
  await run(
    "INSERT INTO conversations (id, business_id, visitor_email, created_at) VALUES (?, ?, ?, ?)",
    row.id, row.business_id, row.visitor_email, row.created_at,
  );
  return row;
}

export function getConversation(businessId: string, id: string): Promise<Conversation | undefined> {
  return get<Conversation>("SELECT * FROM conversations WHERE id = ? AND business_id = ?", id, businessId);
}

export async function setConversationEmail(id: string, email: string) {
  await run("UPDATE conversations SET visitor_email = ? WHERE id = ?", email, id);
}

export async function addMessage(
  conversationId: string,
  role: Message["role"],
  body: string,
  citations?: string[],
): Promise<Message> {
  const row: Message = {
    id: crypto.randomUUID(),
    conversation_id: conversationId,
    role,
    body,
    citations: citations?.length ? JSON.stringify(citations) : null,
    created_at: new Date().toISOString(),
  };
  await run(
    `INSERT INTO messages (id, conversation_id, role, body, citations, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    row.id, row.conversation_id, row.role, row.body, row.citations, row.created_at,
  );
  return row;
}

export function listMessages(conversationId: string): Promise<Message[]> {
  return all<Message>("SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC", conversationId);
}

/** Opens (or updates the email on) the ticket for a conversation the caller already scoped. */
export async function createTicket(conversationId: string, email: string): Promise<Ticket> {
  const existing = await getTicketByConversation(conversationId);
  const nextEmail = email.trim().toLowerCase();
  const realEmail = nextEmail.includes("@") && nextEmail !== PENDING_TICKET_EMAIL;
  if (existing) {
    if (realEmail) {
      const now = new Date().toISOString();
      await run("UPDATE tickets SET email = ?, updated_at = ? WHERE id = ?", nextEmail, now, existing.id);
      await setConversationEmail(conversationId, nextEmail);
      return (await getTicket(existing.business_id, existing.id)) ?? existing;
    }
    return existing;
  }

  const conversation = await get<{ business_id: string }>(
    "SELECT business_id FROM conversations WHERE id = ?",
    conversationId,
  );
  if (!conversation) throw new Error(`no conversation ${conversationId}`);
  const last = await get<{ body: string }>(
    "SELECT body FROM messages WHERE conversation_id = ? AND role = 'visitor' ORDER BY created_at DESC LIMIT 1",
    conversationId,
  );
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
    intent: null,
    intent_reason: null,
  };
  await run(
    `INSERT INTO tickets (id, business_id, conversation_id, email, status, preview, created_at, updated_at, assignee)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    row.id, row.business_id, row.conversation_id, row.email, row.status,
    row.preview, row.created_at, row.updated_at, row.assignee,
  );
  await setConversationEmail(conversationId, nextEmail);
  return row;
}

export function listTickets(businessId: string): Promise<Ticket[]> {
  return all<Ticket>(
    `SELECT t.*, EXISTS(
       SELECT 1 FROM agent_drafts d WHERE d.ticket_id = t.id AND d.status = 'pending'
     )::int AS has_draft
     FROM tickets t WHERE t.business_id = ? ORDER BY t.updated_at DESC`,
    businessId,
  );
}

export function getTicket(businessId: string, id: string): Promise<Ticket | undefined> {
  return get<Ticket>("SELECT * FROM tickets WHERE id = ? AND business_id = ?", id, businessId);
}

export function getTicketByConversation(conversationId: string): Promise<Ticket | undefined> {
  return get<Ticket>("SELECT * FROM tickets WHERE conversation_id = ?", conversationId);
}

/** Posts a staff reply; an unassigned ticket goes to whoever replied. */
export async function replyToTicket(
  businessId: string,
  id: string,
  body: string,
  staffName: string,
): Promise<Ticket | undefined> {
  const ticket = await getTicket(businessId, id);
  if (!ticket) return undefined;
  await addMessage(ticket.conversation_id, "agent", body);
  const now = new Date().toISOString();
  // A person answered, so the "needs a human" flag is settled.
  await run(
    "UPDATE tickets SET status = 'waiting', assignee = COALESCE(assignee, ?), needs_human_reason = NULL, updated_at = ? WHERE id = ?",
    staffName, now, id,
  );
  return getTicket(businessId, id);
}

export async function updateTicket(
  businessId: string,
  id: string,
  patch: { status?: Ticket["status"]; assignee?: string | null },
): Promise<Ticket | undefined> {
  const ticket = await getTicket(businessId, id);
  if (!ticket) return undefined;
  const status = patch.status ?? ticket.status;
  const assignee = patch.assignee === undefined ? ticket.assignee : patch.assignee;
  const now = new Date().toISOString();
  await run("UPDATE tickets SET status = ?, assignee = ?, updated_at = ? WHERE id = ?", status, assignee, now, id);
  return getTicket(businessId, id);
}

export async function setTicketTriage(
  id: string,
  triage: {
    topic: string;
    summary: string;
    needsHumanReason: string | null;
    intent: Ticket["intent"];
    intentReason: string;
  },
) {
  await run(
    "UPDATE tickets SET topic = ?, summary = ?, needs_human_reason = ?, intent = ?, intent_reason = ? WHERE id = ?",
    triage.topic, triage.summary, triage.needsHumanReason, triage.intent, triage.intentReason, id,
  );
}

/** Saves a pending draft and supersedes any earlier pending draft for the ticket. */
export async function insertDraft(
  draft: Omit<AgentDraft, "id" | "status" | "final_body" | "reject_reason" | "created_at" | "decided_at">,
): Promise<AgentDraft> {
  const row: AgentDraft = {
    ...draft,
    id: `drf_${crypto.randomUUID().slice(0, 8)}`,
    status: "pending",
    final_body: null,
    reject_reason: null,
    created_at: new Date().toISOString(),
    decided_at: null,
  };
  await transaction(async () => {
    await run(
      "UPDATE agent_drafts SET status = 'superseded', decided_at = ? WHERE ticket_id = ? AND status = 'pending'",
      row.created_at, row.ticket_id,
    );
    await run(
      `INSERT INTO agent_drafts (id, ticket_id, kind, body, citations, rationale, based_on_message_id,
         status, final_body, reject_reason, model, prompt_version, created_at, decided_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      row.id, row.ticket_id, row.kind, row.body, row.citations, row.rationale,
      row.based_on_message_id, row.status, row.final_body, row.reject_reason,
      row.model, row.prompt_version, row.created_at, row.decided_at,
    );
  });
  return row;
}

export function getPendingDraft(ticketId: string): Promise<AgentDraft | undefined> {
  return get<AgentDraft>(
    "SELECT * FROM agent_drafts WHERE ticket_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1",
    ticketId,
  );
}

export function getDraft(businessId: string, id: string): Promise<AgentDraft | undefined> {
  return get<AgentDraft>(
    `SELECT d.* FROM agent_drafts d JOIN tickets t ON t.id = d.ticket_id
     WHERE d.id = ? AND t.business_id = ?`,
    id,
    businessId,
  );
}

/** Records the decision on a pending draft. False when it was already decided, say by a double-click. */
export async function decideDraft(
  id: string,
  decision: { status: "sent" | "edited" | "rejected"; finalBody?: string; rejectReason?: string },
): Promise<boolean> {
  const changed = await run(
    "UPDATE agent_drafts SET status = ?, final_body = ?, reject_reason = ?, decided_at = ? WHERE id = ? AND status = 'pending'",
    decision.status,
    decision.finalBody ?? null,
    decision.rejectReason ?? null,
    new Date().toISOString(),
    id,
  );
  return changed === 1;
}

/**
 * Marks a pending draft sent (or edited) and posts it as the staff reply, in one transaction, so a
 * crash can't leave it marked sent with nothing sent. Undefined when the draft was already decided.
 */
export function sendDraft(
  businessId: string,
  draft: { id: string; ticket_id: string; body: string },
  finalBody: string,
  staffName: string,
): Promise<Ticket | undefined> {
  return transaction(async () => {
    if (!(await decideDraft(draft.id, { status: finalBody === draft.body ? "sent" : "edited", finalBody }))) {
      return undefined;
    }
    return replyToTicket(businessId, draft.ticket_id, finalBody, staffName);
  });
}

export async function recordRun(run_: Omit<AgentRun, "id" | "created_at">): Promise<AgentRun> {
  const row: AgentRun = {
    ...run_,
    id: `run_${crypto.randomUUID().slice(0, 8)}`,
    created_at: new Date().toISOString(),
  };
  await run(
    `INSERT INTO agent_runs (id, ticket_id, trigger, outcome, detail, input_tokens, output_tokens, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    row.id, row.ticket_id, row.trigger, row.outcome, row.detail,
    row.input_tokens, row.output_tokens, row.created_at,
  );
  return row;
}

export function listRuns(ticketId: string, limit = 5): Promise<AgentRun[]> {
  return all<AgentRun>(
    "SELECT * FROM agent_runs WHERE ticket_id = ? ORDER BY created_at DESC LIMIT ?",
    ticketId,
    limit,
  );
}

export async function countRunsSince(ticketId: string, sinceIso: string): Promise<number> {
  const row = await get<{ n: number }>(
    "SELECT COUNT(*)::int AS n FROM agent_runs WHERE ticket_id = ? AND created_at >= ?",
    ticketId,
    sinceIso,
  );
  return row?.n ?? 0;
}

export async function getSetting(businessId: string, key: string): Promise<string | undefined> {
  const row = await get<{ value: string }>(
    "SELECT value FROM business_settings WHERE business_id = ? AND key = ?",
    businessId,
    key,
  );
  return row?.value;
}

export async function setSetting(businessId: string, key: string, value: string) {
  await run(
    `INSERT INTO business_settings (business_id, key, value) VALUES (?, ?, ?)
     ON CONFLICT(business_id, key) DO UPDATE SET value = excluded.value`,
    businessId, key, value,
  );
}

/** "2026-10" for any time in October 2026, UTC. Voice minutes reset on the first of each month. */
export function usageMonth(at = new Date()): string {
  return at.toISOString().slice(0, 7);
}

export async function voiceSecondsUsed(businessId: string, month = usageMonth()): Promise<number> {
  const row = await get<{ seconds: number }>(
    "SELECT seconds FROM voice_usage WHERE business_id = ? AND month = ?",
    businessId,
    month,
  );
  return row?.seconds ?? 0;
}

export async function addVoiceSeconds(businessId: string, seconds: number, month = usageMonth()) {
  if (!(seconds > 0)) return;
  await run(
    `INSERT INTO voice_usage (business_id, month, seconds) VALUES (?, ?, ?)
     ON CONFLICT(business_id, month) DO UPDATE SET seconds = voice_usage.seconds + excluded.seconds`,
    businessId, month, seconds,
  );
}

/** Signs staff sessions. RELAYDESK_SESSION_SECRET wins; otherwise one is made once and kept here. */
export async function sessionSecret(): Promise<string> {
  const fromEnv = process.env.RELAYDESK_SESSION_SECRET;
  if (fromEnv) return fromEnv;
  await run(
    "INSERT INTO settings (key, value) VALUES ('session_secret', ?) ON CONFLICT DO NOTHING",
    randomBytes(32).toString("base64url"),
  );
  const row = await get<{ value: string }>("SELECT value FROM settings WHERE key = 'session_secret'");
  return row!.value;
}

// Businesses, their staff, and their articles.

export const BUSINESS_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

export function getBusiness(id: string): Promise<Business | undefined> {
  return get<Business>("SELECT * FROM businesses WHERE id = ?", id);
}

export async function createBusiness(business: { id: string; name: string; live?: boolean }): Promise<Business> {
  if (!BUSINESS_ID_PATTERN.test(business.id)) {
    throw new Error(
      `business id "${business.id}" must be lowercase letters, digits, and dashes (2-40 chars)`,
    );
  }
  const row: Business = {
    id: business.id,
    name: business.name.trim(),
    articles_version: 0,
    live: business.live === false ? 0 : 1,
    created_at: new Date().toISOString(),
  };
  await run(
    "INSERT INTO businesses (id, name, articles_version, live, created_at) VALUES (?, ?, ?, ?, ?)",
    row.id, row.name, row.articles_version, row.live, row.created_at,
  );
  return row;
}

export async function setBusinessLive(id: string, live: boolean) {
  await run("UPDATE businesses SET live = ? WHERE id = ?", live ? 1 : 0, id);
}

/**
 * Self-serve sign-up: a business that isn't live yet, and its first staff
 * login. Both or neither, so a taken email doesn't leave an orphan business.
 */
export function signUpBusiness(input: {
  businessId: string;
  businessName: string;
  name: string;
  email: string;
  password: string;
}): Promise<Staff> {
  return transaction(async () => {
    await createBusiness({ id: input.businessId, name: input.businessName, live: false });
    return createStaff({
      businessId: input.businessId,
      email: input.email,
      name: input.name,
      password: input.password,
    });
  });
}

export function listArticles(businessId: string): Promise<Article[]> {
  return all<Article>(
    `SELECT slug, title, category, summary, body FROM articles
     WHERE business_id = ? ORDER BY position, slug`,
    businessId,
  );
}

function bumpArticlesVersion(businessId: string) {
  return run("UPDATE businesses SET articles_version = articles_version + 1 WHERE id = ?", businessId);
}

/** Replaces the business's whole help center; the answer graph picks it up on the next chat. */
export function replaceArticles(businessId: string, articles: Article[]) {
  const now = new Date().toISOString();
  return transaction(async () => {
    await run("DELETE FROM articles WHERE business_id = ?", businessId);
    for (const [position, a] of articles.entries()) {
      await run(
        `INSERT INTO articles (business_id, slug, title, category, summary, body, position, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        businessId, a.slug, a.title, a.category, a.summary, a.body, position, now,
      );
    }
    await bumpArticlesVersion(businessId);
  });
}

/**
 * Adds articles, or updates the ones whose slug already exists. With
 * `replacing`, the article at that old slug is edited (its slug may change).
 */
export function saveArticles(
  businessId: string,
  articles: Article[],
  options: { replacing?: string } = {},
) {
  const now = new Date().toISOString();
  return transaction(async () => {
    if (options.replacing) {
      await run("DELETE FROM articles WHERE business_id = ? AND slug = ?", businessId, options.replacing);
    }
    const row = await get<{ next: number }>(
      "SELECT COALESCE(MAX(position), -1) + 1 AS next FROM articles WHERE business_id = ?",
      businessId,
    );
    const next = row?.next ?? 0;
    for (const [i, a] of articles.entries()) {
      await run(
        `INSERT INTO articles (business_id, slug, title, category, summary, body, position, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(business_id, slug) DO UPDATE SET title = excluded.title,
           category = excluded.category, summary = excluded.summary, body = excluded.body,
           updated_at = excluded.updated_at`,
        businessId, a.slug, a.title, a.category, a.summary, a.body, next + i, now,
      );
    }
    await bumpArticlesVersion(businessId);
  });
}

export async function deleteArticle(businessId: string, slug: string): Promise<boolean> {
  const changed = await run("DELETE FROM articles WHERE business_id = ? AND slug = ?", businessId, slug);
  if (changed > 0) await bumpArticlesVersion(businessId);
  return changed > 0;
}

export async function createStaff(staff: {
  businessId: string;
  email: string;
  name: string;
  password: string;
}): Promise<Staff> {
  const row: Staff = {
    id: `staff_${crypto.randomUUID().slice(0, 8)}`,
    business_id: staff.businessId,
    email: staff.email.trim().toLowerCase(),
    name: staff.name.trim(),
    created_at: new Date().toISOString(),
  };
  await run(
    `INSERT INTO staff (id, business_id, email, name, password_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    row.id, row.business_id, row.email, row.name, hashPassword(staff.password), row.created_at,
  );
  return row;
}

export function listStaff(businessId: string): Promise<Staff[]> {
  return all<Staff>(
    "SELECT id, business_id, email, name, created_at FROM staff WHERE business_id = ? ORDER BY created_at",
    businessId,
  );
}

export function getStaffByEmail(email: string): Promise<Staff | undefined> {
  return get<Staff>(
    "SELECT id, business_id, email, name, created_at FROM staff WHERE email = ?",
    email.trim().toLowerCase(),
  );
}

/**
 * Removes a login. Their open session stops working on the next request, and the MCP tokens and
 * unaccepted invites they made go with it, so neither keeps a way back in.
 */
export function removeStaff(businessId: string, id: string): Promise<boolean> {
  return transaction(async () => {
    const removed = (await run("DELETE FROM staff WHERE business_id = ? AND id = ?", businessId, id)) > 0;
    if (!removed) return false;
    await run("DELETE FROM mcp_tokens WHERE business_id = ? AND created_by = ?", businessId, id);
    await run(
      "DELETE FROM invites WHERE business_id = ? AND invited_by = ? AND accepted_at IS NULL",
      businessId,
      id,
    );
    return true;
  });
}

/** The business's first login, made at sign-up. Only they can remove teammates. */
export async function isOwner(staff: { id: string; business_id: string }): Promise<boolean> {
  const first = await get<{ id: string }>(
    "SELECT id FROM staff WHERE business_id = ? ORDER BY created_at, id LIMIT 1",
    staff.business_id,
  );
  return first?.id === staff.id;
}

export function getStaff(businessId: string, id: string): Promise<Staff | undefined> {
  return get<Staff>(
    "SELECT id, business_id, email, name, created_at FROM staff WHERE id = ? AND business_id = ?",
    id,
    businessId,
  );
}

const UNKNOWN_EMAIL_HASH = hashPassword(randomBytes(16).toString("base64url"));

/** The staff member for this email and password, or undefined. */
export async function checkStaffLogin(email: string, password: string): Promise<Staff | undefined> {
  const normalized = email.trim().toLowerCase();
  const hash = await get<{ password_hash: string }>("SELECT password_hash FROM staff WHERE email = ?", normalized);
  // Unknown emails still pay for one scrypt, so response time doesn't say which emails exist.
  const ok = verifyPassword(password, hash?.password_hash ?? UNKNOWN_EMAIL_HASH);
  if (!hash || !ok) return undefined;
  return getStaffByEmail(normalized);
}

// Staff invites. The link carries a random token; only its hash is stored.

export const INVITE_TTL_MS = 1000 * 60 * 60 * 24 * 7;

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Creates an invite and returns it with the one-time token for the link. */
export async function createInvite(input: {
  businessId: string;
  email: string;
  invitedBy: string;
}): Promise<{ invite: Invite; token: string }> {
  const token = randomBytes(24).toString("base64url");
  const now = Date.now();
  const invite: Invite = {
    id: `inv_${crypto.randomUUID().slice(0, 8)}`,
    business_id: input.businessId,
    email: input.email.trim().toLowerCase(),
    invited_by: input.invitedBy,
    created_at: new Date(now).toISOString(),
    expires_at: new Date(now + INVITE_TTL_MS).toISOString(),
    accepted_at: null,
  };
  await run(
    `INSERT INTO invites (id, business_id, email, token_hash, invited_by, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    invite.id, invite.business_id, invite.email, tokenHash(token),
    invite.invited_by, invite.created_at, invite.expires_at,
  );
  return { invite, token };
}

/** Invites not yet accepted or expired. */
export function listPendingInvites(businessId: string): Promise<Invite[]> {
  return all<Invite>(
    `SELECT id, business_id, email, invited_by, created_at, expires_at, accepted_at FROM invites
     WHERE business_id = ? AND accepted_at IS NULL AND expires_at > ? ORDER BY created_at DESC`,
    businessId,
    new Date().toISOString(),
  );
}

export async function revokeInvite(businessId: string, id: string): Promise<boolean> {
  return (await run("DELETE FROM invites WHERE business_id = ? AND id = ? AND accepted_at IS NULL", businessId, id)) > 0;
}

/** The open invite behind a link's token, or undefined if it's unknown, used, or expired. */
export function findInvite(token: string): Promise<Invite | undefined> {
  return get<Invite>(
    `SELECT id, business_id, email, invited_by, created_at, expires_at, accepted_at FROM invites
     WHERE token_hash = ? AND accepted_at IS NULL AND expires_at > ?`,
    tokenHash(token),
    new Date().toISOString(),
  );
}

/** Turns an invite into a staff login for the invited email. Each link works once. */
export function acceptInvite(token: string, input: { name: string; password: string }): Promise<Staff> {
  return transaction(async () => {
    const invite = await findInvite(token);
    if (!invite) throw new Error("This invite link is used, expired, or wrong.");
    // Only the first of two simultaneous accepts changes the row; the other finds it taken.
    const claimed = await run(
      "UPDATE invites SET accepted_at = ? WHERE id = ? AND accepted_at IS NULL",
      new Date().toISOString(),
      invite.id,
    );
    if (claimed !== 1) throw new Error("This invite link is used, expired, or wrong.");
    return createStaff({
      businessId: invite.business_id,
      email: invite.email,
      name: input.name,
      password: input.password,
    });
  });
}

// MCP access tokens: one per assistant a business connects. Only the hash is kept.

export async function createMcpToken(input: {
  businessId: string;
  name: string;
  createdBy: string;
}): Promise<{ token: string; row: McpToken }> {
  const token = `rdk_${randomBytes(24).toString("base64url")}`;
  const row: McpToken = {
    id: `mcp_${crypto.randomUUID().slice(0, 8)}`,
    business_id: input.businessId,
    name: input.name.trim(),
    created_by: input.createdBy,
    created_at: new Date().toISOString(),
    last_used_at: null,
  };
  await run(
    `INSERT INTO mcp_tokens (id, business_id, name, token_hash, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    row.id, row.business_id, row.name, tokenHash(token), row.created_by, row.created_at,
  );
  return { token, row };
}

export function listMcpTokens(businessId: string): Promise<McpToken[]> {
  return all<McpToken>(
    `SELECT id, business_id, name, created_by, created_at, last_used_at FROM mcp_tokens
     WHERE business_id = ? ORDER BY created_at DESC`,
    businessId,
  );
}

export async function revokeMcpToken(businessId: string, id: string): Promise<boolean> {
  return (await run("DELETE FROM mcp_tokens WHERE business_id = ? AND id = ?", businessId, id)) > 0;
}

export async function countMcpTokens(): Promise<number> {
  return (await get<{ n: number }>("SELECT COUNT(*)::int AS n FROM mcp_tokens"))?.n ?? 0;
}

/** The business a bearer token belongs to, recording that it was used. */
export async function redeemMcpToken(token: string): Promise<{ businessId: string; tokenId: string } | undefined> {
  const row = await get<{ id: string; business_id: string }>(
    "SELECT id, business_id FROM mcp_tokens WHERE token_hash = ?",
    tokenHash(token),
  );
  if (!row) return undefined;
  await run("UPDATE mcp_tokens SET last_used_at = ? WHERE id = ?", new Date().toISOString(), row.id);
  return { businessId: row.business_id, tokenId: row.id };
}
