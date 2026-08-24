import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export type Conversation = {
  id: string;
  visitor_email: string | null;
  created_at: string;
};

export type Message = {
  id: string;
  conversation_id: string;
  role: "visitor" | "assistant" | "agent";
  body: string;
  citations: string | null;
  created_at: string;
};

export type Ticket = {
  id: string;
  conversation_id: string;
  email: string;
  status: "open" | "waiting" | "closed";
  preview: string;
  created_at: string;
  updated_at: string;
};

type GlobalDb = typeof globalThis & { __relaydeskDb?: Database.Database };

function open(): Database.Database {
  const g = globalThis as GlobalDb;
  if (g.__relaydeskDb) return g.__relaydeskDb;

  const dir = path.join(process.cwd(), "data");
  fs.mkdirSync(dir, { recursive: true });
  const db = new Database(path.join(dir, "relaydesk.db"));
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
      updated_at TEXT NOT NULL
    );
  `);
  seedIfEmpty(db);
  g.__relaydeskDb = db;
  return db;
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
    JSON.stringify(["How billing works: seats and events"]),
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
    "I checked your workspace — JIT is off and owen@harborapps.com was never invited. I sent a viewer invite. After you accept it, Google SSO will let you in.",
    null,
    late,
  );

  const insertTicket = db.prepare(
    `INSERT INTO tickets (id, conversation_id, email, status, preview, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  insertTicket.run(
    "tkt_seats",
    c1,
    "priya@northline.io",
    "open",
    "Invoice shows 12 seats but we only have 9 people",
    late,
    late,
  );
  insertTicket.run(
    "tkt_sso",
    c2,
    "owen@harborapps.com",
    "waiting",
    "SSO keeps bouncing me back to Google",
    late,
    iso,
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
  if (existing) return existing;

  const last = db()
    .prepare(
      "SELECT body FROM messages WHERE conversation_id = ? AND role = 'visitor' ORDER BY created_at DESC LIMIT 1",
    )
    .get(conversationId) as { body: string } | undefined;
  const now = new Date().toISOString();
  const row: Ticket = {
    id: `tkt_${crypto.randomUUID().slice(0, 8)}`,
    conversation_id: conversationId,
    email,
    status: "open",
    preview: (last?.body ?? "New conversation").slice(0, 140),
    created_at: now,
    updated_at: now,
  };
  db()
    .prepare(
      `INSERT INTO tickets (id, conversation_id, email, status, preview, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.id,
      row.conversation_id,
      row.email,
      row.status,
      row.preview,
      row.created_at,
      row.updated_at,
    );
  setConversationEmail(conversationId, email);
  return row;
}

export function listTickets(): Ticket[] {
  return db()
    .prepare("SELECT * FROM tickets ORDER BY updated_at DESC")
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
  db()
    .prepare("UPDATE tickets SET status = 'waiting', updated_at = ? WHERE id = ?")
    .run(now, id);
  return getTicket(id);
}
