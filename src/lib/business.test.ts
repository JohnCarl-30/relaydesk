import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, describe, it } from "node:test";
import { loadHelpCenter } from "./business";
import { COPILOT_SETTING, copilotEnabled, runCopilot } from "./copilot";
import * as db from "./db";
import { refuseLine } from "./escalate";
import { answerQuestion } from "./graph";
import { DEMO_BUSINESS_ID } from "./help-center";
import { forceExtractiveAnswers } from "./keyless";
import { decodeSession, encodeSession } from "./session";

forceExtractiveAnswers();
process.env.RELAYDESK_DB_PATH = join(tmpdir(), `relaydesk-business-${process.pid}-${Date.now()}.db`);

const ACME = "acme-coffee";
const ACME_ARTICLES = [
  {
    slug: "delivery-areas",
    title: "Where do you deliver?",
    category: "Orders",
    summary: "Metro Manila in 1 to 2 days, elsewhere by courier.",
    body: "We deliver within Metro Manila in 1 to 2 days. Orders outside Metro Manila ship by courier and take 3 to 5 days.",
  },
  {
    slug: "store-hours",
    title: "What are your store hours?",
    category: "Store",
    summary: "7 am to 9 pm every day.",
    body: "Our Makati branch is open 7 am to 9 pm every day, including holidays.",
  },
];

/** A conversation with a ticket on it, the way the chat route leaves them. */
function ticketFor(businessId: string, question: string) {
  const conversation = db.createConversation(businessId, "ana@example.ph");
  db.addMessage(conversation.id, "visitor", question);
  db.addMessage(conversation.id, "assistant", refuseLine("Test"));
  return { conversation, ticket: db.createTicket(conversation.id, "ana@example.ph") };
}

describe("one business never sees another's data", () => {
  let nimbus: ReturnType<typeof ticketFor>;
  let acme: ReturnType<typeof ticketFor>;

  before(async () => {
    db.createBusiness({ id: ACME, name: "Acme Coffee" });
    db.replaceArticles(ACME, ACME_ARTICLES);
    nimbus = ticketFor(DEMO_BUSINESS_ID, "Can I get a refund?");
    acme = ticketFor(ACME, "Can I get a refund on my beans?");
    await runCopilot(DEMO_BUSINESS_ID, nimbus.ticket.id, "ticket_created");
  });

  it("tickets carry the conversation's business", () => {
    assert.equal(nimbus.ticket.business_id, DEMO_BUSINESS_ID);
    assert.equal(acme.ticket.business_id, ACME);
  });

  it("lists only the business's own tickets", () => {
    const ids = db.listTickets(ACME).map((t) => t.id);
    assert.deepEqual(ids, [acme.ticket.id]);
    assert.ok(!db.listTickets(DEMO_BUSINESS_ID).some((t) => t.business_id !== DEMO_BUSINESS_ID));
  });

  it("does not resolve another business's conversation, ticket, or draft by id", () => {
    assert.equal(db.getConversation(ACME, nimbus.conversation.id), undefined);
    assert.equal(db.getTicket(ACME, nimbus.ticket.id), undefined);
    const draft = db.getPendingDraft(nimbus.ticket.id);
    assert.ok(draft);
    assert.equal(db.getDraft(ACME, draft.id), undefined);
    assert.equal(db.getDraft(DEMO_BUSINESS_ID, draft.id)?.id, draft.id);
  });

  it("cannot reply to or update another business's ticket", () => {
    const before = db.listMessages(nimbus.conversation.id).length;
    assert.equal(db.replyToTicket(ACME, nimbus.ticket.id, "hello from acme", "Ana"), undefined);
    assert.equal(db.updateTicket(ACME, nimbus.ticket.id, { status: "closed" }), undefined);
    assert.equal(db.listMessages(nimbus.conversation.id).length, before);
    assert.equal(db.getTicket(DEMO_BUSINESS_ID, nimbus.ticket.id)?.status, "open");
  });

  it("will not run the co-pilot on another business's ticket", async () => {
    assert.equal((await runCopilot(ACME, nimbus.ticket.id, "regenerate")).outcome, "error");
    assert.equal(db.listRuns(nimbus.ticket.id).length, 1);
  });

  it("keeps settings per business", () => {
    db.setSetting(ACME, COPILOT_SETTING, "off");
    assert.equal(copilotEnabled(ACME), false);
    assert.equal(copilotEnabled(DEMO_BUSINESS_ID), true);
  });

  it("answers from the business's own articles and refuses in its own name", async () => {
    const center = loadHelpCenter(ACME);
    assert.ok(center);
    const answer = await answerQuestion("How long does delivery take outside Metro Manila?", {
      helpCenter: center,
    });
    const acmeSlugs = new Set(ACME_ARTICLES.map((a) => a.slug));
    assert.ok(answer.citations.every((c) => acmeSlugs.has(c.slug)), "cites only Acme articles");
    assert.equal(answer.citations[0]?.slug, "delivery-areas");
    assert.match(answer.answer, /3 to 5 days/);

    const nimbusQuestion = await answerQuestion("How do I set up Okta SSO?", { helpCenter: center });
    assert.equal(nimbusQuestion.answer, "I don't have that in the Acme Coffee help center.");
    assert.equal(nimbusQuestion.citations.length, 0);
  });

  it("rebuilds the search index when the articles change", async () => {
    const first = loadHelpCenter(ACME);
    assert.equal(loadHelpCenter(ACME), first, "unchanged articles reuse the index");
    db.replaceArticles(ACME, [
      ...ACME_ARTICLES,
      {
        slug: "gift-cards",
        title: "Do you sell gift cards?",
        category: "Store",
        summary: "Yes, from 500 pesos.",
        body: "Gift cards come in 500, 1000, and 2000 peso amounts and never expire.",
      },
    ]);
    const center = loadHelpCenter(ACME);
    assert.notEqual(center, first);
    const answer = await answerQuestion("Do you sell gift cards?", { helpCenter: center });
    assert.equal(answer.citations[0]?.slug, "gift-cards");
  });
});

describe("staff logins and sessions", () => {
  it("checks the password and keeps staff inside their business", () => {
    db.createBusiness({ id: "other-shop", name: "Other Shop" });
    const staff = db.createStaff({
      businessId: "other-shop",
      email: "Owner@Other.ph",
      name: "Owner",
      password: "correct horse",
    });
    assert.equal(db.checkStaffLogin("owner@other.ph", "wrong"), undefined);
    assert.equal(db.checkStaffLogin("owner@other.ph", "correct horse")?.id, staff.id);
    assert.equal(db.getStaff(DEMO_BUSINESS_ID, staff.id), undefined);
    assert.equal(db.getStaff("other-shop", staff.id)?.email, "owner@other.ph");
  });

  it("seeds the Nimbus demo login from the environment password", () => {
    assert.equal(
      db.checkStaffLogin(db.DEMO_STAFF_EMAIL, db.demoStaffPassword())?.business_id,
      DEMO_BUSINESS_ID,
    );
  });

  it("rejects a session cookie edited to point at another business", () => {
    const secret = db.sessionSecret();
    const cookie = encodeSession(
      { staffId: "staff_a", businessId: ACME, expiresAt: Date.now() + 60_000 },
      secret,
    );
    assert.equal(decodeSession(cookie, secret)?.businessId, ACME);

    const [, signature] = cookie.split(".");
    const forgedPayload = Buffer.from(
      JSON.stringify({ staffId: "staff_a", businessId: DEMO_BUSINESS_ID, expiresAt: Date.now() + 60_000 }),
    ).toString("base64url");
    assert.equal(decodeSession(`${forgedPayload}.${signature}`, secret), null);
    assert.equal(decodeSession("1", secret), null, "the old relaydesk_admin=1 cookie means nothing");
    assert.equal(decodeSession(cookie, "another secret"), null);
  });

  it("rejects an expired session", () => {
    const secret = db.sessionSecret();
    const cookie = encodeSession({ staffId: "s", businessId: ACME, expiresAt: 1_000 }, secret);
    assert.equal(decodeSession(cookie, secret, 2_000), null);
  });

  it("refuses business ids that would not be safe in a URL", () => {
    assert.throws(() => db.createBusiness({ id: "Acme Coffee", name: "x" }));
    assert.throws(() => db.createBusiness({ id: "../inbox", name: "x" }));
  });
});
