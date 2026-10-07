import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isVisitorEscalation, unsupportedPriceQuestion } from "./escalate";

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

  it("does not read quantity, billing, or role questions as price questions", () => {
    const seats = { text: "Pending invites do not count until they accept." };
    assert.equal(unsupportedPriceQuestion("How much raw data does Starter keep?", sso), false);
    assert.equal(unsupportedPriceQuestion("how much of it can I export?", sso), false);
    assert.equal(unsupportedPriceQuestion("Will I be charged for pending invites?", seats), false);
    assert.equal(unsupportedPriceQuestion("Who is in charge of billing?", seats), false);
  });
});

describe("isVisitorEscalation", () => {
  it("catches the ways visitors ask for a person", () => {
    for (const text of [
      "This didn't help",
      "this did not help",
      "I'd like to talk to a person",
      "Can I speak to someone?",
      "That doesn't match what sales told us. I need a human.",
      "I need a human",
      "I want a real person",
      "can I chat with a live agent",
      "speak with a representative please",
      "human please",
      "get me an agent please",
      "Please open a ticket",
    ]) {
      assert.equal(isVisitorEscalation(text), true, text);
    }
  });

  it("leaves product questions that only mention people or agents alone", () => {
    for (const text of [
      "Do I need a person's email to invite them?",
      "I want a person to have viewer access",
      "Do I need an agent to install the SDK?",
      "How much is it per person?",
      "What does the user agent filter do?",
      "Can someone with viewer access export CSV?",
    ]) {
      assert.equal(isVisitorEscalation(text), false, text);
    }
  });
});

