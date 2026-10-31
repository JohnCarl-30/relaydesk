import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ChatLike } from "./graph";
import { classifyIntent, keywordIntent, parseIntentReply } from "./intent";
import { forceExtractiveAnswers } from "./keyless";

forceExtractiveAnswers();

function model(reply: string | Error): ChatLike {
  return {
    invoke: async () => {
      if (reply instanceof Error) throw reply;
      return { content: reply };
    },
  };
}

describe("keyword intent", () => {
  it("reads the four signals and names what it matched", () => {
    assert.deepEqual(keywordIntent("Do you have a plan for a 15-person team?"), { intent: "lead", reason: 'Mentions "Do you have".' });
    assert.equal(keywordIntent("We need SSO and more seats").intent, "upgrade");
    assert.equal(keywordIntent("How do I export everything and cancel?").intent, "churn_risk");
    assert.deepEqual(keywordIntent("How do I reset my API key?"), { intent: "none", reason: "No sales signal." });
  });

  it("does not read 'cancel a report' or 'switch to annual' as leaving", () => {
    assert.equal(keywordIntent("Can I cancel a scheduled report?").intent, "none");
    assert.equal(keywordIntent("We'd like to switch to annual billing.").intent, "upgrade");
    assert.equal(keywordIntent("Please cancel our subscription.").intent, "churn_risk");
  });

  it("puts leaving above growing when a customer says both", () => {
    assert.equal(keywordIntent("We're cancelling unless you have an enterprise plan with SSO.").intent, "churn_risk");
  });
});

describe("model intent", () => {
  const input = { visitorText: "How much does it cost for a team of 12?", transcript: "Customer: How much does it cost for a team of 12?" };

  it("uses the model's label and reason", async () => {
    const got = await classifyIntent(input, model('```json\n{"intent": "lead", "reason": "Asks the price for a team."}\n```'));
    assert.deepEqual(got, { intent: "lead", reason: "Asks the price for a team." });
  });

  it("falls back to the keywords on an unusable reply or a model error", async () => {
    assert.deepEqual(await classifyIntent(input, model("I think this is a lead.")), keywordIntent(input.visitorText));
    assert.deepEqual(await classifyIntent(input, model('{"intent": "maybe"}')), keywordIntent(input.visitorText));
    assert.deepEqual(await classifyIntent(input, model(new Error("timeout"))), keywordIntent(input.visitorText));
  });

  it("uses the keywords without a model", async () => {
    assert.equal((await classifyIntent(input, null)).intent, "lead");
  });

  it("parses only the four labels", () => {
    assert.equal(parseIntentReply('{"intent": "churn_risk"}')?.reason, "Churn risk");
    assert.equal(parseIntentReply('{"intent": "sale", "reason": "x"}'), null);
    assert.equal(parseIntentReply("none"), null);
  });
});
