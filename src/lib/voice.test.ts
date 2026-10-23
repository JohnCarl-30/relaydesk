import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseChannel, recognitionErrorMessage, SPOKEN_LIMIT, spokenText } from "./voice";

describe("parseChannel", () => {
  it("reads voice, and treats anything else as text", () => {
    assert.equal(parseChannel("voice"), "voice");
    for (const value of ["text", "VOICE", undefined, null, 1]) assert.equal(parseChannel(value), "text");
  });
});

describe("spokenText", () => {
  it("keeps a short answer as it is", () => {
    assert.equal(spokenText("SSO is available on Growth and Scale."), "SSO is available on Growth and Scale.");
  });

  it("says the ticket went to the team instead of reading its id", () => {
    const reply = "I couldn't find that in the help center.\n\nTicket T-4F2A is in the staff inbox.";
    assert.equal(spokenText(reply), "I couldn't find that in the help center. I've passed this to the team.");
  });

  it("drops markdown and does not read links aloud", () => {
    const reply = "Go to **Settings** > `API keys`. See [the guide](https://nimbus.demo/help/api) or https://nimbus.demo/x";
    assert.equal(spokenText(reply), "Go to Settings API keys. See the guide or the link in the chat");
  });

  it("cuts a long answer at a sentence and points to the chat", () => {
    const sentence = "Each workspace keeps raw events for the retention period on its plan. ";
    const spoken = spokenText(sentence.repeat(20));
    assert.ok(spoken.length <= SPOKEN_LIMIT, `${spoken.length} > ${SPOKEN_LIMIT}`);
    assert.match(spoken, /plan\. The rest is in the chat\.$/);
  });

  it("cuts at a word when there is no sentence break", () => {
    const spoken = spokenText("word ".repeat(200), 60);
    assert.match(spoken, /word… The rest is in the chat\.$/);
    assert.ok(spoken.length <= 60);
  });
});

describe("recognitionErrorMessage", () => {
  it("explains blocked mics and silence, and stays quiet when the visitor stopped", () => {
    assert.match(recognitionErrorMessage("not-allowed")!, /Microphone access is blocked/);
    assert.match(recognitionErrorMessage("no-speech")!, /didn't catch that/);
    assert.equal(recognitionErrorMessage("aborted"), null);
    assert.match(recognitionErrorMessage("something-new")!, /Voice input stopped/);
  });
});
