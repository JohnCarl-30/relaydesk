import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { allowRequest, clientIp } from "./rate-limit";

describe("allowRequest", () => {
  it("allows up to the limit in a minute, then refuses until it slides past", () => {
    const t = 1_000_000;
    for (let i = 0; i < 3; i++) assert.equal(allowRequest("a", 3, t + i), true);
    assert.equal(allowRequest("a", 3, t + 10), false);
    assert.equal(allowRequest("a", 3, t + 59_999), false);
    assert.equal(allowRequest("a", 3, t + 60_001), true);
  });

  it("counts each visitor apart", () => {
    assert.equal(allowRequest("b", 1, 0), true);
    assert.equal(allowRequest("b", 1, 1), false);
    assert.equal(allowRequest("c", 1, 1), true);
  });
});

describe("clientIp", () => {
  it("trusts only the entry the proxy appended", () => {
    assert.equal(clientIp(new Headers({ "x-forwarded-for": "6.6.6.6, 203.0.113.7" })), "203.0.113.7");
    assert.equal(clientIp(new Headers({ "x-real-ip": "198.51.100.2" })), "198.51.100.2");
    assert.equal(clientIp(new Headers()), "unknown");
  });
});
