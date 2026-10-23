import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import { trace as otel } from "@opentelemetry/api";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import { runCopilot } from "./copilot";
import * as db from "./db";
import { DEMO_BUSINESS_ID } from "./help-center";
import { answerQuestion } from "./graph";
import {
  dumpSpans,
  flushTracing,
  formatTree,
  initTracing,
  langfuseProcessor,
  resetSpans,
  shouldExportToLangfuse,
  snapshotSpans,
  withSpan,
  type SpanDump,
} from "./trace";

// Stub model, no key, no local trace file, no Langfuse unless a test asks.
delete process.env.OPENAI_API_KEY;
delete process.env.LANGFUSE_PUBLIC_KEY;
delete process.env.LANGFUSE_SECRET_KEY;
process.env.RELAYDESK_STUB_LLM = "1";
process.env.RELAYDESK_TRACE_FILE = "0";
process.env.RELAYDESK_DB_PATH = join(tmpdir(), `relaydesk-langfuse-${process.pid}-${Date.now()}.db`);

async function spans(): Promise<SpanDump[]> {
  await flushTracing();
  return dumpSpans(snapshotSpans());
}

function named(rows: SpanDump[], name: string): SpanDump {
  const row = rows.find((r) => r.name === name);
  assert.ok(row, `no ${name} span in ${rows.map((r) => r.name).join(",")}`);
  return row;
}

beforeEach(() => resetSpans());

describe("langfuseProcessor", () => {
  it("is off without both Langfuse keys", () => {
    assert.equal(langfuseProcessor({}), undefined);
    assert.equal(langfuseProcessor({ LANGFUSE_PUBLIC_KEY: "pk-lf-x" }), undefined);
  });

  it("is a Langfuse span processor when both keys are set", async () => {
    const processor = langfuseProcessor({
      LANGFUSE_PUBLIC_KEY: "pk-lf-test",
      LANGFUSE_SECRET_KEY: "sk-lf-test",
    });
    assert.ok(processor instanceof LangfuseSpanProcessor);
    await processor.shutdown();
  });
});

describe("shouldExportToLangfuse", () => {
  it("keeps relaydesk spans and drops other libraries' plain spans", async () => {
    initTracing();
    await withSpan("support.answer", {}, () => undefined);
    otel.getTracer("next.js").startSpan("GET /api/chat").end();
    await flushTracing();
    const byName = new Map(snapshotSpans().map((s) => [s.name, s]));
    assert.equal(shouldExportToLangfuse({ otelSpan: byName.get("support.answer")! }), true);
    assert.equal(shouldExportToLangfuse({ otelSpan: byName.get("GET /api/chat")! }), false);
  });
});

describe("span redaction", () => {
  it("redacts personal data in every string attribute before export", async () => {
    await withSpan("support.answer", { question: "email me at ana@shop.ph or 0917 123 4567" }, () => undefined);
    const row = named(await spans(), "support.answer");
    assert.equal(row.attributes.question, "email me at [email] or [phone]");
  });
});

describe("answerQuestion traces", () => {
  it("records the model call on generate as a Langfuse generation", async () => {
    await answerQuestion("What is the write-key rate limit?", { rewrite: false });
    const generate = named(await spans(), "generate");
    assert.equal(generate.attributes["langfuse.observation.type"], "generation");
    assert.equal(generate.attributes["gen_ai.request.model"], "stub");
    assert.equal(generate.attributes["gen_ai.usage.input_tokens"], 48);
    assert.equal(generate.attributes["gen_ai.usage.output_tokens"], 32);
    const input = JSON.parse(String(generate.attributes["langfuse.observation.input"]));
    assert.equal(input[0].role, "system");
    assert.match(input[1].content, /write-key rate limit/);
    assert.ok(String(generate.attributes["langfuse.observation.output"]).length > 0);
  });

  it("records the rewrite model call as a generation too", async () => {
    await answerQuestion("what is nimbus", { rewrite: true });
    const rewrite = named(await spans(), "rewrite");
    assert.equal(rewrite.attributes["langfuse.observation.type"], "generation");
    assert.equal(rewrite.attributes["langfuse.observation.output"], rewrite.attributes["rewrite.query"]);
  });

  it("does not mark generate as a generation when no model runs", async () => {
    await answerQuestion("I'd like to talk to a person", { rewrite: false });
    const generate = named(await spans(), "generate");
    assert.equal(generate.attributes["langfuse.observation.type"], undefined);
  });

  it("keeps prompts and answers out of the printed tree", async () => {
    await answerQuestion("What is the write-key rate limit?", { rewrite: false });
    const tree = formatTree(await spans());
    assert.match(tree, /gen_ai\.request\.model=stub/);
    assert.doesNotMatch(tree, /langfuse\.observation\.(input|output)/);
  });

  it("puts the question, answer and session on the root span", async () => {
    const result = await answerQuestion("What is the write-key rate limit?", {
      rewrite: false,
      sessionId: "conv_123",
    });
    const root = named(await spans(), "support.answer");
    assert.equal(root.attributes["session.id"], "conv_123");
    assert.equal(root.attributes["langfuse.observation.input"], "What is the write-key rate limit?");
    assert.equal(root.attributes["langfuse.observation.output"], result.answer);
  });
});

describe("runCopilot traces", () => {
  after(() => {
    delete process.env.RELAYDESK_STUB_LLM;
  });

  it("puts the draft model call in its own generation span under the conversation's session", async () => {
    const conversation = db.createConversation(DEMO_BUSINESS_ID, "priya@northline.io");
    db.addMessage(conversation.id, "visitor", "Do pending invites count as billed seats?");
    db.addMessage(conversation.id, "assistant", "Pending invites do not count until they accept.");
    db.addMessage(conversation.id, "visitor", "This didn't help");
    const ticket = db.createTicket(conversation.id, "priya@northline.io");

    const { outcome } = await runCopilot(DEMO_BUSINESS_ID, ticket.id, "ticket_created");
    assert.equal(outcome, "answer");
    const rows = await spans();
    assert.equal(named(rows, "copilot.run").attributes["session.id"], conversation.id);
    const draft = named(rows, "copilot.draft");
    assert.equal(draft.attributes["langfuse.observation.type"], "generation");
    assert.equal(draft.attributes["gen_ai.request.model"], "stub");
    assert.doesNotMatch(String(draft.attributes["langfuse.observation.input"]), /priya@northline\.io/);
  });
});
