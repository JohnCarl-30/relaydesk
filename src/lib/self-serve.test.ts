import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, mock } from "node:test";
import { loadHelpCenter, loadLiveHelpCenter } from "./business";
import * as db from "./db";
import { forceExtractiveAnswers } from "./keyless";

forceExtractiveAnswers();
process.env.RELAYDESK_DB_PATH = join(tmpdir(), `relaydesk-self-serve-${process.pid}-${Date.now()}.db`);

const article = (slug: string, title: string, body: string) => ({
  slug,
  title,
  category: "General",
  summary: body,
  body,
});

describe("sign-up", () => {
  it("creates a hidden business and its first login together", async () => {
    const owner = await db.signUpBusiness({
      businessId: "bean-there",
      businessName: "Bean There",
      name: "Ana",
      email: "ana@beanthere.ph",
      password: "long enough password",
    });
    assert.equal(owner.business_id, "bean-there");
    assert.equal((await db.getBusiness("bean-there"))?.live, 0);
    assert.equal((await db.checkStaffLogin("ana@beanthere.ph", "long enough password"))?.id, owner.id);
  });

  it("leaves no business behind when the email is taken", async () => {
    await assert.rejects(() =>
      db.signUpBusiness({
        businessId: "second-shop",
        businessName: "Second",
        name: "Ana",
        email: "ana@beanthere.ph",
        password: "long enough password",
      }),
    );
    assert.equal(await db.getBusiness("second-shop"), undefined);
  });
});

describe("going live", () => {
  it("keeps a business's help center from the public until it goes live", async () => {
    assert.ok(await loadHelpCenter("bean-there"), "staff still see it");
    assert.equal(await loadLiveHelpCenter("bean-there"), undefined);
    await db.setBusinessLive("bean-there", true);
    assert.ok(await loadLiveHelpCenter("bean-there"));
    assert.ok(await loadLiveHelpCenter("nimbus"), "the demo is live");
  });
});

describe("editing articles", () => {
  it("adds, edits under a new link, and deletes, rebuilding search each time", async () => {
    await db.saveArticles("bean-there", [article("hours", "Store hours", "7 am to 9 pm.")]);
    const first = await loadHelpCenter("bean-there");
    assert.deepEqual(first?.corpus.articles.map((a) => a.slug), ["hours"]);

    await db.saveArticles("bean-there", [article("opening-hours", "Opening hours", "8 am to 8 pm.")], {
      replacing: "hours",
    });
    await db.saveArticles("bean-there", [article("wifi", "Do you have wifi?", "Yes, ask the barista.")]);
    const second = await loadHelpCenter("bean-there");
    assert.notEqual(second, first);
    assert.deepEqual(second?.corpus.articles.map((a) => a.slug), ["opening-hours", "wifi"]);

    assert.equal(await db.deleteArticle("bean-there", "wifi"), true);
    assert.equal(await db.deleteArticle("bean-there", "wifi"), false);
    assert.equal(await db.deleteArticle("nimbus", "opening-hours"), false, "only the owner's articles");
    assert.deepEqual((await loadHelpCenter("bean-there"))?.corpus.articles.map((a) => a.slug), ["opening-hours"]);
  });

  it("updates an article in place when an import brings the same link", async () => {
    await db.saveArticles("bean-there", [article("opening-hours", "Opening hours", "9 am to 6 pm.")]);
    const articles = await db.listArticles("bean-there");
    assert.equal(articles.length, 1);
    assert.equal(articles[0].body, "9 am to 6 pm.");
  });
});

describe("staff invites", () => {
  const owner = async () => (await db.getStaffByEmail("ana@beanthere.ph"))!;

  it("turns a link into a login for the invited email, once", async () => {
    const { invite, token } = await db.createInvite({
      businessId: "bean-there",
      email: "Ben@BeanThere.ph",
      invitedBy: (await owner()).id,
    });
    assert.equal(invite.email, "ben@beanthere.ph");
    assert.deepEqual((await db.listPendingInvites("bean-there")).map((i) => i.id), [invite.id]);
    assert.equal(await db.findInvite("not-the-token"), undefined);

    const ben = await db.acceptInvite(token, { name: "Ben", password: "another long one" });
    assert.equal(ben.business_id, "bean-there");
    assert.equal(ben.email, "ben@beanthere.ph");
    assert.equal(await db.findInvite(token), undefined);
    await assert.rejects(() => db.acceptInvite(token, { name: "Ben", password: "another long one" }), /used, expired/);
    assert.deepEqual(await db.listPendingInvites("bean-there"), []);
    assert.deepEqual((await db.listStaff("bean-there")).map((s) => s.name), ["Ana", "Ben"]);
  });

  it("stores only a hash of the token", async () => {
    const { token } = await db.createInvite({ businessId: "bean-there", email: "cy@beanthere.ph", invitedBy: (await owner()).id });
    // Read the raw row with a PGlite of our own; only one may hold the directory, so the app's closes first.
    await db.closeDb();
    const { PGlite } = await import("@electric-sql/pglite");
    const raw = await PGlite.create(process.env.RELAYDESK_DB_PATH);
    const { rows } = await raw.query<Record<string, string>>("SELECT * FROM invites WHERE email = $1", ["cy@beanthere.ph"]);
    await raw.close();
    const row = rows[0];
    assert.ok(row);
    assert.ok(!Object.values(row).includes(token));
  });

  it("can't be revoked by another business", async () => {
    const [pending] = await db.listPendingInvites("bean-there");
    assert.equal(await db.revokeInvite("nimbus", pending.id), false);
    assert.equal(await db.revokeInvite("bean-there", pending.id), true);
  });

  it("refuses an expired link", async () => {
    const { invite, token } = await db.createInvite({ businessId: "bean-there", email: "dee@beanthere.ph", invitedBy: (await owner()).id });
    mock.timers.enable({ apis: ["Date"], now: Date.parse(invite.expires_at) + 1 });
    try {
      assert.equal(await db.findInvite(token), undefined);
    } finally {
      mock.timers.reset();
    }
  });

  it("takes a removed teammate's MCP tokens and pending invites with them, and only the owner may remove", async () => {
    const eve = await db.createStaff({ businessId: "bean-there", email: "eve@beanthere.ph", name: "Eve", password: "a long password" });
    assert.equal(await db.isOwner(await owner()), true);
    assert.equal(await db.isOwner(eve), false);
    await db.createMcpToken({ businessId: "bean-there", name: "Eve's Claude", createdBy: eve.id });
    const { invite } = await db.createInvite({ businessId: "bean-there", email: "mallory@evil.test", invitedBy: eve.id });
    assert.equal(await db.removeStaff("bean-there", eve.id), true);
    assert.ok(!(await db.listMcpTokens("bean-there")).some((t) => t.created_by === eve.id));
    assert.ok(!(await db.listPendingInvites("bean-there")).some((i) => i.id === invite.id));
  });

  it("removes a teammate only within the business", async () => {
    const ben = (await db.getStaffByEmail("ben@beanthere.ph"))!;
    assert.equal(await db.removeStaff("nimbus", ben.id), false);
    assert.equal(await db.removeStaff("bean-there", ben.id), true);
    assert.equal(await db.getStaff("bean-there", ben.id), undefined, "their session stops resolving");
  });
});

describe("replies", () => {
  it("assign an unassigned ticket to whoever replied", async () => {
    const conversation = await db.createConversation("bean-there", "cust@example.ph");
    await db.addMessage(conversation.id, "visitor", "Is the wifi fast?");
    const ticket = await db.createTicket(conversation.id, "cust@example.ph");
    assert.equal((await db.replyToTicket("bean-there", ticket.id, "Yes!", "Ana"))?.assignee, "Ana");
    assert.equal((await db.replyToTicket("bean-there", ticket.id, "Very.", "Ben"))?.assignee, "Ana");
  });
});
