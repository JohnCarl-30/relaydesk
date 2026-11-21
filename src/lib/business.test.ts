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
import { decodeSession, encodeSession, SESSION_TTL_MS } from "./session";

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
async function ticketFor(businessId: string, question: string) {
  const conversation = await db.createConversation(businessId, "ana@example.ph");
  await db.addMessage(conversation.id, "visitor", question);
  await db.addMessage(conversation.id, "assistant", refuseLine("Test"));
  return { conversation, ticket: await db.createTicket(conversation.id, "ana@example.ph") };
}

describe("one business never sees another's data", () => {
  let nimbus: Awaited<ReturnType<typeof ticketFor>>;
  let acme: Awaited<ReturnType<typeof ticketFor>>;

  before(async () => {
    await db.createBusiness({ id: ACME, name: "Acme Coffee" });
    await db.replaceArticles(ACME, ACME_ARTICLES);
    nimbus = await ticketFor(DEMO_BUSINESS_ID, "Can I get a refund?");
    acme = await ticketFor(ACME, "Can I get a refund on my beans?");
    await runCopilot(DEMO_BUSINESS_ID, nimbus.ticket.id, "ticket_created");
  });

  it("tickets carry the conversation's business", async () => {
    assert.equal(nimbus.ticket.business_id, DEMO_BUSINESS_ID);
    assert.equal(acme.ticket.business_id, ACME);
  });

  it("lists only the business's own tickets", async () => {
    const ids = (await db.listTickets(ACME)).map((t) => t.id);
    assert.deepEqual(ids, [acme.ticket.id]);
    assert.ok(!(await db.listTickets(DEMO_BUSINESS_ID)).some((t) => t.business_id !== DEMO_BUSINESS_ID));
  });

  it("does not resolve another business's conversation, ticket, or draft by id", async () => {
    assert.equal(await db.getConversation(ACME, nimbus.conversation.id), undefined);
    assert.equal(await db.getTicket(ACME, nimbus.ticket.id), undefined);
    const draft = await db.getPendingDraft(nimbus.ticket.id);
    assert.ok(draft);
    assert.equal(await db.getDraft(ACME, draft.id), undefined);
    assert.equal((await db.getDraft(DEMO_BUSINESS_ID, draft.id))?.id, draft.id);
  });

  it("cannot reply to or update another business's ticket", async () => {
    const before = (await db.listMessages(nimbus.conversation.id)).length;
    assert.equal(await db.replyToTicket(ACME, nimbus.ticket.id, "hello from acme", "Ana"), undefined);
    assert.equal(await db.updateTicket(ACME, nimbus.ticket.id, { status: "closed" }), undefined);
    assert.equal((await db.listMessages(nimbus.conversation.id)).length, before);
    assert.equal((await db.getTicket(DEMO_BUSINESS_ID, nimbus.ticket.id))?.status, "open");
  });

  it("will not run the co-pilot on another business's ticket", async () => {
    assert.equal((await runCopilot(ACME, nimbus.ticket.id, "regenerate")).outcome, "error");
    assert.equal((await db.listRuns(nimbus.ticket.id)).length, 1);
  });

  it("keeps settings per business", async () => {
    await db.setSetting(ACME, COPILOT_SETTING, "off");
    assert.equal(await copilotEnabled(ACME), false);
    assert.equal(await copilotEnabled(DEMO_BUSINESS_ID), true);
  });

  it("answers from the business's own articles and refuses in its own name", async () => {
    const center = await loadHelpCenter(ACME);
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
    const first = await loadHelpCenter(ACME);
    assert.equal(await loadHelpCenter(ACME), first, "unchanged articles reuse the index");
    await db.replaceArticles(ACME, [
      ...ACME_ARTICLES,
      {
        slug: "gift-cards",
        title: "Do you sell gift cards?",
        category: "Store",
        summary: "Yes, from 500 pesos.",
        body: "Gift cards come in 500, 1000, and 2000 peso amounts and never expire.",
      },
    ]);
    const center = await loadHelpCenter(ACME);
    assert.notEqual(center, first);
    const answer = await answerQuestion("Do you sell gift cards?", { helpCenter: center });
    assert.equal(answer.citations[0]?.slug, "gift-cards");
  });
});

describe("staff logins and sessions", () => {
  it("checks the password and keeps staff inside their business", async () => {
    await db.createBusiness({ id: "other-shop", name: "Other Shop" });
    const staff = await db.createStaff({
      businessId: "other-shop",
      email: "Owner@Other.ph",
      name: "Owner",
      password: "correct horse",
    });
    assert.equal(await db.checkStaffLogin("owner@other.ph", "wrong"), undefined);
    assert.equal((await db.checkStaffLogin("owner@other.ph", "correct horse"))?.id, staff.id);
    assert.equal(await db.getStaff(DEMO_BUSINESS_ID, staff.id), undefined);
    assert.equal((await db.getStaff("other-shop", staff.id))?.email, "owner@other.ph");
  });

  it("seeds the Nimbus demo login from the environment password", async () => {
    assert.equal(
      (await db.checkStaffLogin(db.DEMO_STAFF_EMAIL, db.demoStaffPassword()))?.business_id,
      DEMO_BUSINESS_ID,
    );
  });

  it("keeps the Nimbus setup read-only only while it takes the printed password", async () => {
    const saved = process.env.RELAYDESK_ADMIN_PASSWORD;
    try {
      delete process.env.RELAYDESK_ADMIN_PASSWORD;
      assert.equal(db.isPublicDemo({ business_id: DEMO_BUSINESS_ID }), true);
      assert.equal(db.isPublicDemo({ business_id: "other-shop" }), false);
      process.env.RELAYDESK_ADMIN_PASSWORD = "a private password";
      assert.equal(db.isPublicDemo({ business_id: DEMO_BUSINESS_ID }), false);
    } finally {
      if (saved === undefined) delete process.env.RELAYDESK_ADMIN_PASSWORD;
      else process.env.RELAYDESK_ADMIN_PASSWORD = saved;
    }
  });

  it("signs out Nimbus cookies from before the demo password changed", async () => {
    const startedAgo = (ms: number) => ({ businessId: DEMO_BUSINESS_ID, expiresAt: Date.now() - ms + SESSION_TTL_MS });
    const before = startedAgo(1_000);
    assert.equal(await db.demoSessionRevoked(before), false);

    const saved = process.env.RELAYDESK_ADMIN_PASSWORD;
    try {
      process.env.RELAYDESK_ADMIN_PASSWORD = "a rotated private password";
      await db.closeDb(); // the demo password is re-hashed when the database opens
      assert.equal(await db.demoSessionRevoked(before), true);
      assert.equal(await db.demoSessionRevoked({ ...before, businessId: "other-shop" }), false);
      assert.equal(await db.demoSessionRevoked(startedAgo(-1_000)), false);
    } finally {
      if (saved === undefined) delete process.env.RELAYDESK_ADMIN_PASSWORD;
      else process.env.RELAYDESK_ADMIN_PASSWORD = saved;
      await db.closeDb();
    }
  });

  it("signing out stops every cookie that staff member started before it", async () => {
    const staff = { id: "staff-signout", business_id: ACME };
    const startedAt = (t: number) => ({ staffId: staff.id, businessId: ACME, expiresAt: t + SESSION_TTL_MS });
    const now = Date.now();
    assert.equal(await db.signedOutSince(startedAt(now - 1_000)), false);

    await db.recordSignOut(staff, now);
    assert.equal(await db.signedOutSince(startedAt(now - 1_000)), true, "a copied cookie is dead");
    assert.equal(await db.signedOutSince(startedAt(now + 1_000)), false, "signing in again works");
    assert.equal(await db.signedOutSince({ ...startedAt(now - 1_000), staffId: "someone-else" }), false);
  });

  it("rejects a session cookie edited to point at another business", async () => {
    const secret = await db.sessionSecret();
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

  it("rejects an expired session", async () => {
    const secret = await db.sessionSecret();
    const cookie = encodeSession({ staffId: "s", businessId: ACME, expiresAt: 1_000 }, secret);
    assert.equal(decodeSession(cookie, secret, 2_000), null);
  });

  it("refuses business ids that would not be safe in a URL", async () => {
    await assert.rejects(() => db.createBusiness({ id: "Acme Coffee", name: "x" }));
    await assert.rejects(() => db.createBusiness({ id: "../inbox", name: "x" }));
  });
});
