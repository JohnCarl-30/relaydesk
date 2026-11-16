import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { answerQuestion, chatModel, hasLlm } from "./graph";
import { forceExtractiveAnswers } from "./keyless";
import { MODEL_CALLS_PER_DAY, modelBudgetLeft, recordModelCall } from "./rate-limit";

forceExtractiveAnswers();

describe("the daily model budget", () => {
  it("counts calls per UTC day and starts over the next day", () => {
    const day = Date.parse("2020-01-01T10:00:00Z");
    process.env.RELAYDESK_MODEL_CALLS_PER_DAY = "2";
    try {
      assert.equal(modelBudgetLeft(day), true);
      recordModelCall(day);
      recordModelCall(day + 1);
      assert.equal(modelBudgetLeft(day + 2), false);
      assert.equal(modelBudgetLeft(Date.parse("2020-01-02T00:00:00Z")), true);
    } finally {
      delete process.env.RELAYDESK_MODEL_CALLS_PER_DAY;
    }
    assert.ok(MODEL_CALLS_PER_DAY > 0);
  });

  it("counts every real model call, and once spent, chat answers from the articles", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    process.env.OPENAI_BASE_URL = "http://127.0.0.1:9"; // nothing listens, so the call fails fast
    process.env.RELAYDESK_MODEL_CALLS_PER_DAY = "1";
    try {
      assert.equal(hasLlm(), true);
      await chatModel().invoke([{ role: "user", content: "hi" }]).catch(() => null);
      assert.equal(hasLlm(), false, "the failed call still counted");
      const answer = await answerQuestion("How do I rotate an API key?");
      assert.equal(answer.usedLlm, false);
      assert.ok(answer.answer.length > 0);
    } finally {
      delete process.env.OPENAI_API_KEY;
      delete process.env.OPENAI_BASE_URL;
      delete process.env.RELAYDESK_MODEL_CALLS_PER_DAY;
    }
  });
});
