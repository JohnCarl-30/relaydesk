import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
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
  it("creates a hidden business and its first login together", () => {
    const owner = db.signUpBusiness({
      businessId: "bean-there",
      businessName: "Bean There",
      name: "Ana",
      email: "ana@beanthere.ph",
      password: "long enough password",
    });
    assert.equal(owner.business_id, "bean-there");
    assert.equal(db.getBusiness("bean-there")?.live, 0);
    assert.equal(db.checkStaffLogin("ana@beanthere.ph", "long enough password")?.id, owner.id);
  });

  it("leaves no business behind when the email is taken", () => {
    assert.throws(() =>
      db.signUpBusiness({
        businessId: "second-shop",
        businessName: "Second",
        name: "Ana",
        email: "ana@beanthere.ph",
        password: "long enough password",
      }),
    );
    assert.equal(db.getBusiness("second-shop"), undefined);
  });
});

describe("going live", () => {
  it("keeps a business's help center from the public until it goes live", () => {
    assert.ok(loadHelpCenter("bean-there"), "staff still see it");
    assert.equal(loadLiveHelpCenter("bean-there"), undefined);
    db.setBusinessLive("bean-there", true);
    assert.ok(loadLiveHelpCenter("bean-there"));
    assert.ok(loadLiveHelpCenter("nimbus"), "the demo is live");
  });
});

describe("editing articles", () => {
  it("adds, edits under a new link, and deletes, rebuilding search each time", () => {
    db.saveArticles("bean-there", [article("hours", "Store hours", "7 am to 9 pm.")]);
    const first = loadHelpCenter("bean-there");
    assert.deepEqual(first?.corpus.articles.map((a) => a.slug), ["hours"]);

    db.saveArticles("bean-there", [article("opening-hours", "Opening hours", "8 am to 8 pm.")], {
      replacing: "hours",
    });
    db.saveArticles("bean-there", [article("wifi", "Do you have wifi?", "Yes, ask the barista.")]);
    const second = loadHelpCenter("bean-there");
    assert.notEqual(second, first);
    assert.deepEqual(second?.corpus.articles.map((a) => a.slug), ["opening-hours", "wifi"]);

    assert.equal(db.deleteArticle("bean-there", "wifi"), true);
    assert.equal(db.deleteArticle("bean-there", "wifi"), false);
    assert.equal(db.deleteArticle("nimbus", "opening-hours"), false, "only the owner's articles");
    assert.deepEqual(loadHelpCenter("bean-there")?.corpus.articles.map((a) => a.slug), ["opening-hours"]);
  });

  it("updates an article in place when an import brings the same link", () => {
    db.saveArticles("bean-there", [article("opening-hours", "Opening hours", "9 am to 6 pm.")]);
    const articles = db.listArticles("bean-there");
    assert.equal(articles.length, 1);
    assert.equal(articles[0].body, "9 am to 6 pm.");
  });
});

describe("staff invites", () => {
  const owner = () => db.getStaffByEmail("ana@beanthere.ph")!;

  it("turns a link into a login for the invited email, once", () => {
    const { invite, token } = db.createInvite({
      businessId: "bean-there",
      email: "Ben@BeanThere.ph",
      invitedBy: owner().id,
    });
    assert.equal(invite.email, "ben@beanthere.ph");
    assert.deepEqual(db.listPendingInvites("bean-there").map((i) => i.id), [invite.id]);
    assert.equal(db.findInvite("not-the-token"), undefined);

    const ben = db.acceptInvite(token, { name: "Ben", password: "another long one" });
    assert.equal(ben.business_id, "bean-there");
    assert.equal(ben.email, "ben@beanthere.ph");
    assert.equal(db.findInvite(token), undefined);
    assert.throws(() => db.acceptInvite(token, { name: "Ben", password: "another long one" }), /used, expired/);
    assert.deepEqual(db.listPendingInvites("bean-there"), []);
    assert.deepEqual(db.listStaff("bean-there").map((s) => s.name), ["Ana", "Ben"]);
  });

  it("stores only a hash of the token", () => {
    const { token } = db.createInvite({ businessId: "bean-there", email: "cy@beanthere.ph", invitedBy: owner().id });
    const row = db.db().prepare("SELECT * FROM invites WHERE email = ?").get("cy@beanthere.ph") as Record<string, string>;
    assert.ok(!Object.values(row).includes(token));
  });

  it("can't be revoked by another business", () => {
    const [pending] = db.listPendingInvites("bean-there");
    assert.equal(db.revokeInvite("nimbus", pending.id), false);
    assert.equal(db.revokeInvite("bean-there", pending.id), true);
  });

  it("refuses an expired link", () => {
    const { invite, token } = db.createInvite({ businessId: "bean-there", email: "dee@beanthere.ph", invitedBy: owner().id });
    db.db().prepare("UPDATE invites SET expires_at = ? WHERE id = ?").run("2020-01-01T00:00:00.000Z", invite.id);
    assert.equal(db.findInvite(token), undefined);
  });

  it("removes a teammate only within the business", () => {
    const ben = db.getStaffByEmail("ben@beanthere.ph")!;
    assert.equal(db.removeStaff("nimbus", ben.id), false);
    assert.equal(db.removeStaff("bean-there", ben.id), true);
    assert.equal(db.getStaff("bean-there", ben.id), undefined, "their session stops resolving");
  });
});

describe("replies", () => {
  it("assign an unassigned ticket to whoever replied", () => {
    const conversation = db.createConversation("bean-there", "cust@example.ph");
    db.addMessage(conversation.id, "visitor", "Is the wifi fast?");
    const ticket = db.createTicket(conversation.id, "cust@example.ph");
    assert.equal(db.replyToTicket("bean-there", ticket.id, "Yes!", "Ana")?.assignee, "Ana");
    assert.equal(db.replyToTicket("bean-there", ticket.id, "Very.", "Ben")?.assignee, "Ana");
  });
});
