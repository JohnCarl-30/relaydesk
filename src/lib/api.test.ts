import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { authRateLimited } from "./api";

const from = (ip: string) =>
  new Request("http://localhost/api/auth/login", { method: "POST", headers: { "x-forwarded-for": ip } });

describe("authRateLimited", () => {
  it("lets one visitor try 10 times a minute, then answers 429", () => {
    for (let i = 0; i < 10; i++) assert.equal(authRateLimited(from("198.51.100.9")), null);
    assert.equal(authRateLimited(from("198.51.100.9"))?.status, 429);
    assert.equal(authRateLimited(from("198.51.100.10")), null);
  });
});
