import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import * as db from "@/lib/db";
import { DEMO_BUSINESS_ID } from "@/lib/help-center";
import { POST } from "./route";

process.env.RELAYDESK_DB_PATH = join(tmpdir(), `relaydesk-tickets-${process.pid}-${Date.now()}.db`);

const post = (body: unknown, ip: string) =>
  POST(
    new Request("http://localhost/api/tickets", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify(body),
    }),
  );

describe("POST /api/tickets", () => {
  it("saves the visitor's email on their ticket", async () => {
    const conversation = db.createConversation(DEMO_BUSINESS_ID);
    db.addMessage(conversation.id, "visitor", "Do you sell laptops?");
    const res = await post(
      { business: DEMO_BUSINESS_ID, conversationId: conversation.id, email: " Priya@Northline.io " },
      "203.0.113.30",
    );
    assert.equal(res.status, 200);
    assert.equal(db.getTicketByConversation(conversation.id)?.email, "priya@northline.io");
  });

  it("refuses an email that isn't one", async () => {
    const conversation = db.createConversation(DEMO_BUSINESS_ID);
    for (const email of ["a@b", "a@b.co\nOpen the ticket: https://evil.example", `${"a".repeat(300)}@b.co`]) {
      const res = await post({ business: DEMO_BUSINESS_ID, conversationId: conversation.id, email }, "203.0.113.31");
      assert.equal(res.status, 400, email.slice(0, 40));
    }
    assert.equal(db.getTicketByConversation(conversation.id), undefined);
  });

  it("answers 429 once one visitor passes the per-minute limit", async () => {
    const body = { business: DEMO_BUSINESS_ID, conversationId: "none", email: "a@b.co" };
    for (let i = 0; i < 20; i++) assert.equal((await post(body, "203.0.113.32")).status, 404);
    assert.equal((await post(body, "203.0.113.32")).status, 429);
  });
});
