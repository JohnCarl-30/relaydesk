import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { unsupportedPriceQuestion } from "./escalate";

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
