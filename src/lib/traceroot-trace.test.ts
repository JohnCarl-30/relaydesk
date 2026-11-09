import assert from "node:assert/strict";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";

type Received = { url: string; headers: IncomingMessage["headers"]; body: Buffer };
const received: Received[] = [];
const server = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (c: Buffer) => chunks.push(c));
  req.on("end", () => {
    received.push({ url: req.url ?? "", headers: req.headers, body: Buffer.concat(chunks) });
    res.writeHead(200, { "content-type": "application/x-protobuf" }).end();
  });
});

describe("traceRootProcessor", () => {
  let trace: typeof import("./trace");

  before(async () => {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    // initTracing reads the environment once, so it is set before the module first traces.
    process.env.TRACEROOT_API_KEY = "tr-test";
    process.env.TRACEROOT_HOST_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
    process.env.RELAYDESK_TRACE_FILE = "0";
    delete process.env.LANGFUSE_PUBLIC_KEY;
    delete process.env.LANGFUSE_SECRET_KEY;
    trace = await import("./trace");
  });

  after(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it("is off without TRACEROOT_API_KEY", () => {
    assert.equal(trace.traceRootProcessor({}), undefined);
  });

  it("posts redacted spans as OTLP protobuf with the API key", async () => {
    await trace.withSpan("traceroot-check", { "visitor.text": "write to jane@acme.com" }, () => undefined);
    await trace.flushTracing();

    assert.equal(received.length, 1);
    const [request] = received;
    assert.equal(request.url, "/api/v1/public/traces");
    assert.equal(request.headers["content-type"], "application/x-protobuf");
    assert.equal(request.headers.authorization, "Bearer tr-test");
    const body = request.body.toString("latin1");
    assert.ok(body.includes("traceroot-check"));
    // RedactingSpanProcessor runs first, so the address never leaves the process.
    assert.ok(body.includes("[email]"));
    assert.ok(!body.includes("jane@acme.com"));
  });
});
