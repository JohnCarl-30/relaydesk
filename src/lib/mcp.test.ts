import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { COPILOT_SETTING, MAX_RUNS_PER_DAY } from "./copilot";
import * as db from "./db";
import { DEMO_BUSINESS_ID } from "./help-center";
import { forceExtractiveAnswers } from "./keyless";
import { buildMcpServer, MCP_DRAFT_MODEL } from "./mcp";
import { authenticateMcp } from "./mcp-auth";
import { dumpSpans, flushTracing, resetSpans, snapshotSpans } from "./trace";

forceExtractiveAnswers();
delete process.env.RELAYDESK_MCP_TOKEN;
process.env.RELAYDESK_DB_PATH = join(tmpdir(), `relaydesk-mcp-${process.pid}-${Date.now()}.db`);

const OTHER = "other-shop";

async function connect(businessId = DEMO_BUSINESS_ID) {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await buildMcpServer(businessId).connect(serverSide);
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(clientSide);
  return client;
}

type Result = { isError?: boolean; content: { type: string; text: string }[] };

async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = (await client.callTool({ name, arguments: args })) as Result;
  const text = result.content[0]?.text ?? "";
  return {
    isError: Boolean(result.isError),
    text,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tool output is free-form JSON
    json: () => JSON.parse(text) as Record<string, any>,
  };
}

/** A fresh Nimbus ticket the way the chat route leaves one. */
async function ticket(question = "Do pending invites count as billed seats?") {
  const conversation = await db.createConversation(DEMO_BUSINESS_ID, "priya@northline.io");
  await db.addMessage(conversation.id, "visitor", question);
  await db.addMessage(conversation.id, "visitor", "This didn't help");
  return db.createTicket(conversation.id, "priya@northline.io");
}

describe("authenticateMcp", () => {
  it("is off until a token exists", async () => {
    assert.equal(await authenticateMcp("Bearer anything"), "off");
  });

  it("maps the demo token to Nimbus and a business token to its business", async () => {
    process.env.RELAYDESK_MCP_TOKEN = "demo-token-123";
    try {
      assert.deepEqual(await authenticateMcp("Bearer demo-token-123"), { businessId: DEMO_BUSINESS_ID });
      assert.equal(await authenticateMcp("Bearer demo-token-12"), "unauthorized");
      assert.equal(await authenticateMcp(null), "unauthorized");
      assert.equal(await authenticateMcp("demo-token-123"), "unauthorized", "needs the Bearer scheme");
    } finally {
      delete process.env.RELAYDESK_MCP_TOKEN;
    }

    await db.createBusiness({ id: OTHER, name: "Other Shop" });
    const owner = await db.createStaff({ businessId: OTHER, email: "o@other.test", name: "Olga", password: "long password 1" });
    const { token, row } = await db.createMcpToken({ businessId: OTHER, name: "Claude", createdBy: owner.id });
    assert.match(token, /^rdk_/);
    assert.deepEqual(await authenticateMcp(`Bearer ${token}`), { businessId: OTHER });
    assert.ok((await db.listMcpTokens(OTHER))[0].last_used_at, "records use");
    assert.equal(await authenticateMcp("Bearer rdk_wrong"), "unauthorized");

    assert.equal(await db.revokeMcpToken(DEMO_BUSINESS_ID, row.id), false, "only its own business can revoke it");
    assert.equal(await db.revokeMcpToken(OTHER, row.id), true);
    assert.equal(await authenticateMcp(`Bearer ${token}`), "off", "no tokens left");
  });

  it("stores only a hash of the token", async () => {
    const { token } = await db.createMcpToken({ businessId: OTHER, name: "Cursor", createdBy: "x" });
    // Read the raw rows with a PGlite of our own; only one may hold the directory, so the app's closes first.
    await db.closeDb();
    const { PGlite } = await import("@electric-sql/pglite");
    const raw = await PGlite.create(process.env.RELAYDESK_DB_PATH);
    const { rows } = await raw.query<Record<string, unknown>>("SELECT * FROM mcp_tokens");
    await raw.close();
    assert.ok(rows.length > 0);
    assert.ok(rows.every((row) => !Object.values(row).includes(token)));
  });
});

describe("MCP tools", () => {
  let client: Client;
  before(async () => {
    client = await connect();
  });

  it("offers the seven tools, none of which can message a customer", async () => {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), [
      "draft_reply",
      "get_article",
      "get_ticket",
      "list_tickets",
      "regenerate_draft",
      "search_help_center",
      "update_ticket",
    ]);
    const readOnly = tools.filter((t) => t.annotations?.readOnlyHint).map((t) => t.name).sort();
    assert.deepEqual(readOnly, ["get_article", "get_ticket", "list_tickets", "search_help_center"]);
    assert.ok(tools.every((t) => t.annotations?.destructiveHint === false));
  });

  it("lists and filters tickets", async () => {
    const all = (await call(client, "list_tickets")).json().tickets as { id: string }[];
    assert.ok(all.some((t) => t.id === "tkt_seats"));
    const waiting = (await call(client, "list_tickets", { status: "waiting" })).json().tickets as { id: string }[];
    assert.deepEqual(waiting.map((t) => t.id), ["tkt_sso"]);
    const unassigned = (await call(client, "list_tickets", { assignee: null })).json().tickets as { id: string }[];
    assert.ok(unassigned.some((t) => t.id === "tkt_seats") && !unassigned.some((t) => t.id === "tkt_sso"));
  });

  it("gets a ticket's conversation", async () => {
    const result = (await call(client, "get_ticket", { ticket_id: "tkt_seats" })).json();
    assert.equal(result.ticket.id, "tkt_seats");
    assert.equal(result.messages[0].role, "customer");
    assert.match(result.messages.at(-1).body, /I need a human/);
  });

  it("searches the help center and reads an article", async () => {
    const results = (await call(client, "search_help_center", { query: "SSO keeps looping back to Google" })).json()
      .results as { slug: string }[];
    assert.equal(results[0].slug, "sso");
    const article = (await call(client, "get_article", { slug: "sso" })).json().article;
    assert.equal(article.title, "Set up Google or Okta SSO");
    assert.equal((await call(client, "get_article", { slug: "nope" })).isError, true);
  });

  it("updates a ticket with the inbox's own rules", async () => {
    const t = await ticket();
    const bad = await call(client, "update_ticket", { ticket_id: t.id, status: "done" });
    assert.equal(bad.isError, true);
    assert.match(bad.text, /bad status/);
    const stranger = await call(client, "update_ticket", { ticket_id: t.id, assignee: "Mallory" });
    assert.equal(stranger.isError, true);
    assert.match(stranger.text, /bad assignee/);
    assert.equal((await call(client, "update_ticket", { ticket_id: t.id })).isError, true);

    const done = (await call(client, "update_ticket", { ticket_id: t.id, status: "waiting", assignee: "You" })).json();
    assert.deepEqual(done.ticket, { id: t.id, status: "waiting", assignee: "You" });
    await call(client, "update_ticket", { ticket_id: t.id, assignee: null });
    assert.equal((await db.getTicket(DEMO_BUSINESS_ID, t.id))?.assignee, null);
  });

  it("saves a draft for review without posting anything to the customer", async () => {
    const t = await ticket();
    const before = await db.listMessages(t.conversation_id);
    const first = await call(client, "draft_reply", {
      ticket_id: t.id,
      body: "Hi Priya, pending invites don't count until they're accepted.",
      rationale: "Answered from the billing article.",
      citations: ["billing-seats-events"],
    });
    assert.equal(first.isError, false);
    const second = await call(client, "draft_reply", {
      ticket_id: t.id,
      body: "Hi Priya, a teammate will follow up.",
      rationale: "Holding reply.",
    });

    assert.deepEqual(await db.listMessages(t.conversation_id), before, "messages are unchanged");
    const pending = await db.getPendingDraft(t.id);
    assert.equal(pending?.id, second.json().draft.id);
    assert.equal(pending?.model, MCP_DRAFT_MODEL);
    assert.equal(pending?.kind, "holding");
    assert.equal((await db.getDraft(DEMO_BUSINESS_ID, first.json().draft.id))?.status, "superseded");
    assert.equal(
      (await db.getDraft(DEMO_BUSINESS_ID, first.json().draft.id))?.citations,
      JSON.stringify(["How billing works: seats and the invoice"]),
    );

    const unknown = await call(client, "draft_reply", { ticket_id: t.id, body: "x", rationale: "y", citations: ["made-up"] });
    assert.equal(unknown.isError, true);
    assert.match(unknown.text, /made-up/);
  });

  it("regenerates with the co-pilot's switch and daily limit", async () => {
    const t = await ticket();
    const ran = await call(client, "regenerate_draft", { ticket_id: t.id });
    assert.equal(ran.isError, false);
    assert.equal(ran.json().outcome, "holding");

    await db.setSetting(DEMO_BUSINESS_ID, COPILOT_SETTING, "off");
    try {
      const off = await call(client, "regenerate_draft", { ticket_id: t.id });
      assert.equal(off.isError, true);
      assert.match(off.text, /switched off/);
    } finally {
      await db.setSetting(DEMO_BUSINESS_ID, COPILOT_SETTING, "on");
    }

    for (let i = 1; i < MAX_RUNS_PER_DAY; i += 1) await call(client, "regenerate_draft", { ticket_id: t.id });
    const limited = await call(client, "regenerate_draft", { ticket_id: t.id });
    assert.equal(limited.isError, true);
    assert.match(limited.text, /daily run limit/);
  });

  it("traces each tool call as an mcp.<tool> span", async () => {
    resetSpans();
    await call(client, "search_help_center", { query: "csv export" });
    await flushTracing();
    const span = dumpSpans(snapshotSpans()).find((s) => s.name === "mcp.search_help_center");
    assert.ok(span);
    assert.equal(span.attributes["business.id"], DEMO_BUSINESS_ID);
  });
});

describe("MCP tools for another business", () => {
  it("can't see or touch Nimbus tickets or articles", async () => {
    const client = await connect(OTHER);
    assert.deepEqual((await call(client, "list_tickets")).json().tickets, []);
    for (const [tool, args] of [
      ["get_ticket", { ticket_id: "tkt_seats" }],
      ["update_ticket", { ticket_id: "tkt_seats", status: "closed" }],
      ["draft_reply", { ticket_id: "tkt_seats", body: "x", rationale: "y" }],
      ["regenerate_draft", { ticket_id: "tkt_seats" }],
      ["get_article", { slug: "sso" }],
    ] as const) {
      assert.equal((await call(client, tool, args)).isError, true, tool);
    }
    assert.deepEqual((await call(client, "search_help_center", { query: "SSO" })).json().results, []);
    assert.equal((await db.getTicket(DEMO_BUSINESS_ID, "tkt_seats"))?.status, "open");
  });
});
