import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { REFUSE_LINE } from "./escalate";
import { answerQuestion, generateFromHits } from "./graph";
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
