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

  it("passes only relaydesk spans, re-rooted, with input and output TraceRoot reads", async () => {
    const { InMemorySpanExporter, SimpleSpanProcessor } = await import("@opentelemetry/sdk-trace-base");
    const { NodeTracerProvider } = await import("@opentelemetry/sdk-trace-node");
    const { context, trace: api } = await import("@opentelemetry/api");
    const memory = new InMemorySpanExporter();
    const provider = new NodeTracerProvider({
      spanProcessors: [new trace.TraceRootSpanProcessor(new SimpleSpanProcessor(memory))],
    });
    const next = provider.getTracer("next.js");
    const relaydesk = provider.getTracer("relaydesk");

    // A Next.js request span around relaydesk's answer, the way POST /api/chat nests it.
    // Parents are passed explicitly: this provider has no context manager.
    const request = next.startSpan("POST /api/chat");
    const answer = relaydesk.startSpan(
      "support.answer",
      { attributes: { "langfuse.observation.input": "How do I set up SSO?" } },
      api.setSpan(context.active(), request),
    );
    relaydesk.startSpan("retrieve", {}, api.setSpan(context.active(), answer)).end();
    answer.setAttribute("langfuse.observation.output", "Go to Settings → Security → SSO.");
    answer.end();
    request.end();
    next.startSpan("RSC GET /inbox").end();

    const spans = memory.getFinishedSpans();
    assert.deepEqual(spans.map((s) => s.name).sort(), ["retrieve", "support.answer"]);
    const sent = spans.find((s) => s.name === "support.answer")!;
    const retrieve = spans.find((s) => s.name === "retrieve")!;
    // The answer lost its Next.js parent, so TraceRoot sees it as the root; retrieve keeps its parent.
    assert.equal(sent.parentSpanContext, undefined);
    assert.equal(retrieve.parentSpanContext?.spanId, sent.spanContext().spanId);
    assert.equal(sent.attributes["input.value"], "How do I set up SSO?");
    assert.equal(sent.attributes["output.value"], "Go to Settings → Security → SSO.");
    assert.equal(sent.attributes["langfuse.observation.input"], "How do I set up SSO?");
    // The span other processors hold is unchanged.
    assert.equal((answer as unknown as { parentSpanContext?: { spanId: string } }).parentSpanContext?.spanId, request.spanContext().spanId);
    assert.equal((answer as unknown as { attributes: Record<string, unknown> }).attributes["input.value"], undefined);
    await provider.shutdown();
  });

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
