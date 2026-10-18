import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { redactText } from "./redact";

describe("redactText", () => {
  it("replaces email addresses", () => {
    assert.equal(
      redactText("Reach me at priya.n+billing@northline.io today"),
      "Reach me at [email] today",
    );
  });

  it("replaces phone numbers in local and international formats", () => {
    assert.equal(redactText("Call +63 917 123 4567 please"), "Call [phone] please");
    assert.equal(redactText("my number is 0917-123-4567"), "my number is [phone]");
    assert.equal(redactText("(02) 8123 4567 is the office"), "[phone] is the office");
  });

  it("replaces card numbers", () => {
    assert.equal(redactText("card 4111 1111 1111 1111 was charged"), "card [card] was charged");
  });

  it("leaves ordinary numbers alone", () => {
    const kept = [
      "Growth includes 10,000,000 events a month",
      "Billing closes on 2026-10-17",
      "The write key allows 429 retries after 60 seconds",
      "Plan 50000 events",
      "Ticket tkt_8f3a2c is open",
    ];
    for (const text of kept) assert.equal(redactText(text), text);
  });
});
