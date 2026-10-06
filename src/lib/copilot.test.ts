import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { COPILOT_SETTING, MAX_RUNS_PER_DAY, readTicket, runCopilot } from "./copilot";
import * as db from "./db";
import { REFUSE_LINE } from "./escalate";
import { forceExtractiveAnswers } from "./keyless";

forceExtractiveAnswers();
// A fresh database per test file. db.ts reads this on first use, not at import.
process.env.RELAYDESK_DB_PATH = join(tmpdir(), `relaydesk-copilot-${process.pid}-${Date.now()}.db`);

type Turn = ["visitor" | "assistant", string];

/** Builds a conversation the way the chat route does, then opens a ticket on it. */
function ticketFrom(turns: Turn[], email = "priya@northline.io") {
  const conversation = db.createConversation(email);
  for (const [role, body] of turns) db.addMessage(conversation.id, role, body);
  return db.createTicket(conversation.id, email);
}

const REFUSED = `${REFUSE_LINE}\n\nTicket tkt_x is in the staff inbox.`;

describe("readTicket", () => {
  const read = (turns: Turn[], email?: string) => {
    const ticket = ticketFrom(turns, email);
    return readTicket(ticket, db.listMessages(ticket.conversation_id));
  };

  it("files an out-of-scope question as not in the help center", () => {
    const context = read([["visitor", "How do I connect Nimbus to Salesforce?"], ["assistant", REFUSED]]);
    assert.equal(context.reason, "not_in_help_center");
    assert.equal(context.question, "How do I connect Nimbus to Salesforce?");
  });

  it("keeps the real question when the customer says it didn't help", () => {
    const context = read([
      ["visitor", "Do pending invites count as billed seats?"],
      ["assistant", "Pending invites do not count until they accept."],
      ["visitor", "This didn't help"],
      ["assistant", REFUSED],
    ]);
    assert.equal(context.reason, "answer_didnt_help");
    assert.equal(context.question, "Do pending invites count as billed seats?");
  });

  it("treats pushback after an answer as asking for a person", () => {
    const context = read([
      ["visitor", "Our invoice shows 12 seats but we only have 9 people."],
      ["assistant", "Seat count on the invoice is a snapshot from the last day of the billing period."],
      ["visitor", "That doesn't match what sales told us. I need a human."],
    ]);
    assert.equal(context.reason, "asked_for_person");
    assert.equal(context.question, "Our invoice shows 12 seats but we only have 9 people.");
  });

  it("flags refunds and similar as a person's decision", () => {
    const context = read([["visitor", "I want a refund for last month"], ["assistant", REFUSED]]);
    assert.equal(context.reason, "policy");
    assert.equal(context.policyTerm, "refund");
  });

  it("greets by first name, or 'there' without a real email", () => {
    assert.equal(read([["visitor", "hi"]], "priya.santos@northline.io").name, "Priya");
    assert.equal(read([["visitor", "hi"]], "unassigned@nimbus.demo").name, "there");
  });
});

describe("runCopilot without a model", () => {
  const didntHelp: Turn[] = [
    ["visitor", "Do pending invites count as billed seats?"],
    ["assistant", "Pending invites do not count until they accept."],
    ["visitor", "This didn't help"],
    ["assistant", REFUSED],
  ];

  it("saves a holding draft, files the ticket, and never posts to the customer", async () => {
    const ticket = ticketFrom(didntHelp);
    const before = db.listMessages(ticket.conversation_id).length;

    const result = await runCopilot(ticket.id, "ticket_created");

    assert.equal(result.outcome, "holding");
    const draft = db.getPendingDraft(ticket.id);
    assert.ok(draft);
    assert.equal(draft.kind, "holding");
    assert.equal(draft.model, "template");
    assert.match(draft.body, /^Hi Priya, thanks for letting us know the article didn't answer it\./);
    const filed = db.getTicket(ticket.id);
    assert.equal(filed?.topic, "Billing");
    assert.equal(filed?.summary, "Do pending invites count as billed seats?");
    assert.match(filed?.needs_human_reason ?? "", /didn't help/);
    assert.equal(db.listRuns(ticket.id)[0].outcome, "holding");
    assert.equal(db.listMessages(ticket.conversation_id).length, before, "co-pilot must not send");
  });

  it("keeps one pending draft per ticket; regenerating supersedes the old one", async () => {
    const ticket = ticketFrom(didntHelp);
    const first = (await runCopilot(ticket.id, "ticket_created")).draft;
    const second = (await runCopilot(ticket.id, "regenerate")).draft;
    assert.ok(first && second && first.id !== second.id);
    assert.equal(db.getDraft(first.id)?.status, "superseded");
    assert.equal(db.getPendingDraft(ticket.id)?.id, second.id);
  });

  it("does nothing when switched off", async () => {
    const ticket = ticketFrom(didntHelp);
    db.setSetting(COPILOT_SETTING, "off");
    try {
      assert.equal((await runCopilot(ticket.id, "ticket_created")).outcome, "disabled");
      assert.equal(db.getPendingDraft(ticket.id), undefined);
    } finally {
      db.setSetting(COPILOT_SETTING, "on");
    }
  });

  it("stops after the daily run limit", async () => {
    const ticket = ticketFrom(didntHelp);
    for (let i = 0; i < MAX_RUNS_PER_DAY; i += 1) await runCopilot(ticket.id, "regenerate");
    assert.equal((await runCopilot(ticket.id, "regenerate")).outcome, "rate_limited");
  });
});

describe("runCopilot with a model (stub)", () => {
  it("drafts an answer when articles apply, but holds anything about refunds", async () => {
    process.env.RELAYDESK_STUB_LLM = "1";
    try {
      const answerable = ticketFrom([
        ["visitor", "Do pending invites count as billed seats?"],
        ["assistant", "Pending invites do not count until they accept."],
        ["visitor", "This didn't help"],
        ["assistant", REFUSED],
      ]);
      const answer = await runCopilot(answerable.id, "ticket_created");
      assert.equal(answer.outcome, "answer");
      assert.equal(answer.draft?.model, "stub");
      assert.equal(db.getTicket(answerable.id)?.needs_human_reason, null);

      const refund = ticketFrom([["visitor", "Can I get a refund for unused seats?"], ["assistant", REFUSED]]);
      assert.equal((await runCopilot(refund.id, "ticket_created")).outcome, "holding");
    } finally {
      delete process.env.RELAYDESK_STUB_LLM;
    }
  });
});
