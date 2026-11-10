import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";
import { authRateLimited, readBody } from "./api";

const from = (ip: string) =>
  new Request("http://localhost/api/auth/login", { method: "POST", headers: { "x-forwarded-for": ip } });

describe("authRateLimited", () => {
  it("lets one visitor try 10 times a minute, then answers 429", () => {
    for (let i = 0; i < 10; i++) assert.equal(authRateLimited(from("198.51.100.9")), null);
    assert.equal(authRateLimited(from("198.51.100.9"))?.status, 429);
    assert.equal(authRateLimited(from("198.51.100.10")), null);
  });
});

describe("readBody", () => {
  const Body = z.object({ text: z.string() });
  const post = (body: BodyInit, init: RequestInit = {}) =>
    new Request("http://localhost/api/chat", { method: "POST", body, ...init });

  it("reads a body that fits", async () => {
    assert.deepEqual(await readBody(post(JSON.stringify({ text: "héllo" })), Body, 100), { data: { text: "héllo" } });
  });

  it("refuses a body over the limit with a 413", async () => {
    const res = await readBody(post(JSON.stringify({ text: "x".repeat(200) })), Body, 100);
    assert.equal("error" in res && res.error.status, 413);
  });

  it("stops reading a chunked body, which has no Content-Length, once it passes the limit", async () => {
    let sent = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent++;
        controller.enqueue(new Uint8Array(60).fill(32));
      },
    });
    const res = await readBody(post(endless, { duplex: "half" } as RequestInit), Body, 100);
    assert.equal("error" in res && res.error.status, 413);
    assert.ok(sent < 10, `read ${sent} chunks of an endless body`);
  });
});
