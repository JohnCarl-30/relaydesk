import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import * as db from "@/lib/db";
import { DEMO_BUSINESS_ID } from "@/lib/help-center";
import { forceExtractiveAnswers } from "@/lib/keyless";
import { POST } from "./route";

forceExtractiveAnswers();
process.env.RELAYDESK_DB_PATH = join(tmpdir(), `relaydesk-chat-${process.pid}-${Date.now()}.db`);

const post = (body: unknown, ip: string) =>
  POST(
    new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify(body),
    }),
  );

describe("POST /api/chat", () => {
  it("refuses a message too long to be a question, before saving it or asking the model", async () => {
    const conversation = db.createConversation(DEMO_BUSINESS_ID);
    const res = await post(
      { business: DEMO_BUSINESS_ID, conversationId: conversation.id, message: "x".repeat(2_001) },
      "203.0.113.21",
    );
    assert.equal(res.status, 400);
    assert.equal(db.listMessages(conversation.id).length, 0);
  });

  it("refuses an email that isn't one, so it can't write extra lines into the staff's new-ticket email", async () => {
    const res = await post(
      { business: DEMO_BUSINESS_ID, message: "hi", email: "a@b.co\n\nOpen the ticket: https://evil.example" },
      "203.0.113.22",
    );
    assert.equal(res.status, 400);
  });

  it("reopens the customer's ticket and moves it up when they write again", async () => {
    const conversation = db.createConversation(DEMO_BUSINESS_ID, "priya@northline.io");
    const ticket = db.createTicket(conversation.id, "priya@northline.io");
    const waiting = db.updateTicket(DEMO_BUSINESS_ID, ticket.id, { status: "waiting" })!;
    await new Promise((resolve) => setTimeout(resolve, 5)); // so updated_at can move

    const res = await POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.20" },
        body: JSON.stringify({ business: DEMO_BUSINESS_ID, conversationId: conversation.id, message: "Thanks!" }),
      }),
    );
    assert.equal(res.status, 200);
    const after = db.getTicket(DEMO_BUSINESS_ID, ticket.id)!;
    assert.equal(after.status, "open");
    assert.ok(after.updated_at > waiting.updated_at);
  });
});
