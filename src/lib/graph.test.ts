import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { REFUSE_LINE } from "./escalate";
import { answerQuestion, chatModel, generateFromHits } from "./graph";
import { forceExtractiveAnswers } from "./keyless";
import { retrieve } from "./rag";

forceExtractiveAnswers();

describe("generateFromHits", () => {
  it("answers and refuses exactly like the widget", async () => {
    const questions = [
      "What is the write-key rate limit?",
      "How much does SSO cost?",
      "I'd like to talk to a person",
    ];
    for (const question of questions) {
      const widget = await answerQuestion(question);
      const evalPath = await generateFromHits(question, retrieve(question));
      assert.deepEqual(evalPath, widget, question);
    }
    assert.equal((await answerQuestion("How much does SSO cost?")).answer, REFUSE_LINE);
  });
});

describe("answerQuestion when the model is down", () => {
  it("answers from the articles instead of throwing", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    process.env.OPENAI_BASE_URL = "http://127.0.0.1:9"; // nothing listens there, so every call fails
    try {
      const started = Date.now();
      const result = await answerQuestion("what is nimbus");
      assert.equal(result.usedLlm, false);
      assert.ok(result.answer.length > 0);
      assert.ok(Date.now() - started < 10_000, "no long retry loop");
      // A provider that accepts the call and never answers is cut off by these, not by a hung request.
      const model = chatModel() as unknown as { timeout?: number; caller?: { maxRetries?: number } };
      assert.equal(model.timeout, 10_000);
      assert.equal(model.caller?.maxRetries, 1);
    } finally {
      delete process.env.OPENAI_API_KEY;
      delete process.env.OPENAI_BASE_URL;
    }
  });
});
