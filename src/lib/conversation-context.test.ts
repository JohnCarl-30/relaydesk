import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ACKNOWLEDGEMENT_REPLY,
  explicitAnchors,
  fallbackStandaloneQuestion,
  isAcknowledgement,
  preferTopic,
  unsupportedPriceQuestion,
  type ConversationTurn,
} from "./conversation-context";
import { REFUSE_LINE } from "./escalate";
import { answerQuestion } from "./graph";

// Keyless extractive path, and keep test spans out of eval/traces/live.jsonl.
delete process.env.OPENAI_API_KEY;
delete process.env.RELAYDESK_STUB_LLM;
process.env.RELAYDESK_TRACE_FILE = "0";

const visitor = (body: string): ConversationTurn => ({ role: "visitor", body });
const assistant = (body: string): ConversationTurn => ({ role: "assistant", body });

const GROWTH_QUOTA = [
  visitor("What is the Growth plan event quota?"),
  assistant("Growth includes 10 seats and 10M events."),
];

describe("follow-up answers without a model", () => {
  it("replies to thanks without escalating", async () => {
    for (const text of ["Thanks!", "Got it, perfect", "ok thank you so much"]) {
      const result = await answerQuestion(text, { history: GROWTH_QUOTA });
      assert.equal(result.answer, ACKNOWLEDGEMENT_REPLY, text);
      assert.equal(result.escalated, false, text);
    }
  });

  it("answers a follow-up about waiting from the payment article", async () => {
    const result = await answerQuestion("how long do I have to wait?", {
      history: [
        visitor("What happens if a Nimbus payment fails?"),
        assistant("If a card is declined we retry on day 3, 7, and 14."),
      ],
    });
    assert.equal(result.escalated, false);
    assert.equal(result.citations[0]?.slug, "failed-payment");
  });

  it("answers a follow-up with a quantity from the billing article", async () => {
    const result = await answerQuestion("And if we have 20 seats?", {
      history: [
        visitor("How does Nimbus billing work?"),
        assistant("Nimbus bills two dimensions: seats plus a monthly event quota."),
      ],
    });
    assert.equal(result.escalated, false);
    assert.equal(result.citations[0]?.slug, "billing-seats-events");
  });

  it("keeps the plan-quota topic across chained follow-ups", async () => {
    const result = await answerQuestion("and Starter?", {
      history: [
        ...GROWTH_QUOTA,
        visitor("What about Scale?"),
        assistant("Scale is unlimited seats with a custom event cap."),
      ],
    });
    assert.equal(result.escalated, false);
    assert.equal(result.citations[0]?.slug, "billing-plans");
    assert.match(result.answer, /Starter is 3 seats and 1M events/);
  });

  it("quotes sentences about the follow-up, not the earlier question", async () => {
    const result = await answerQuestion("Can I export them first?", {
      history: [
        visitor("How long does Starter keep raw events?"),
        assistant("Starter keeps raw events 30 days."),
      ],
    });
    assert.equal(result.escalated, false);
    assert.match(result.answer.split("\n\n")[0], /export/i);
  });

  it("answers a follow-up naming a covered plan", async () => {
    const result = await answerQuestion("What about Scale?", { history: GROWTH_QUOTA });
    assert.equal(result.escalated, false);
    assert.match(result.answer, /Scale is unlimited seats/);
  });

  it("still escalates a follow-up naming something the help center lacks", async () => {
    const result = await answerQuestion("What about Salesforce?", { history: GROWTH_QUOTA });
    assert.equal(result.answer, REFUSE_LINE);
    assert.equal(result.escalated, true);
  });
});

describe("isAcknowledgement", () => {
  it("does not swallow questions or complaints", () => {
    assert.equal(isAcknowledgement("thanks, but what about Scale?"), false);
    assert.equal(isAcknowledgement("this didn't help"), false);
    assert.equal(isAcknowledgement("that?"), false);
  });
});

describe("explicitAnchors", () => {
  it("keeps named subjects and drops filler, verbs, and quantities", () => {
    assert.deepEqual(explicitAnchors("Great, what about Scale?"), ["Scale"]);
    assert.deepEqual(explicitAnchors("Sorry, and Okta?"), ["Okta"]);
    assert.deepEqual(explicitAnchors("what about hubspot?"), ["hubspot"]);
    assert.deepEqual(explicitAnchors("how long do I have to wait?"), []);
    assert.deepEqual(explicitAnchors("And if we have 20 seats?"), []);
    assert.deepEqual(explicitAnchors("What about them?"), []);
  });
});

describe("preferTopic", () => {
  const hit = (slug: string, text: string) => ({ article: { slug }, text });
  const hits = [
    hit("data-retention", "Starter keeps raw events 30 days."),
    hit("billing-plans", "Starter is 3 seats and 1M events."),
  ];

  it("moves the topic article first when it covers the follow-up", () => {
    const ordered = preferTopic(hits, "billing-plans", "Great, and Starter?");
    assert.deepEqual(ordered.map((h) => h.article.slug), ["billing-plans", "data-retention"]);
  });

  it("ignores words no hit uses", () => {
    const ordered = preferTopic(hits, "billing-plans", "does that also happen on Starter?");
    assert.equal(ordered[0].article.slug, "billing-plans");
  });

  it("leaves the order alone when the top hit matches more of the follow-up", () => {
    assert.equal(preferTopic(hits, "billing-plans", "and how long are raw events kept?"), hits);
    assert.equal(preferTopic(hits, "workspaces", "and Starter?"), hits);
  });
});

describe("unsupportedPriceQuestion", () => {
  const sso = { text: "SSO is available on Growth and Scale." };

  it("flags a price question the answering article has no price for", () => {
    assert.equal(unsupportedPriceQuestion("how much does it cost?", sso), true);
    assert.equal(unsupportedPriceQuestion("is there a fee for that?", undefined), true);
  });

  it("allows price questions the article answers, and non-price questions", () => {
    const overage = { text: "We invoice the overage at $0.00012 per extra event." };
    const payment = { text: "We do not charge a reactivation fee." };
    assert.equal(unsupportedPriceQuestion("how much does that cost?", overage), false);
    assert.equal(unsupportedPriceQuestion("do you charge a fee to reactivate?", payment), false);
    assert.equal(unsupportedPriceQuestion("Is it available on Starter?", sso), false);
  });
});

describe("fallbackStandaloneQuestion", () => {
  it("walks back through follow-ups to the last standalone question", () => {
    const standalone = fallbackStandaloneQuestion("and Starter?", [
      ...GROWTH_QUOTA,
      visitor("What about Scale?"),
      assistant("Scale is unlimited seats with a custom event cap."),
    ]);
    assert.equal(
      standalone?.search,
      "What is the Growth plan event quota?\nWhat about Scale?\nand Starter?",
    );
    assert.match(standalone?.prompt ?? "", /^Previous question: .*\n.*\nFollow-up question: and Starter\?$/);
  });

  it("skips thanks and requests for a person", () => {
    const standalone = fallbackStandaloneQuestion("and Starter?", [
      ...GROWTH_QUOTA,
      visitor("thanks"),
      visitor("talk to a person"),
    ]);
    assert.equal(standalone?.search, "What is the Growth plan event quota?\nand Starter?");
  });

  it("returns nothing without an earlier question", () => {
    assert.equal(fallbackStandaloneQuestion("and Starter?", [visitor("thanks")]), null);
  });
});
