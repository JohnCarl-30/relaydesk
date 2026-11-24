import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { anthropicToolModel, TOOLS } from "../src/lib/agent";
import { chatModel, chatModelName } from "../src/lib/graph";
import { experimentSuite } from "./suite";

// A fake Messages API. It rejects what the real one 400s for current Claude models
// (https://platform.claude.com/docs/en/api/messages), so a bad request fails here first.
function rejection(body: Record<string, unknown>): string | null {
  for (const key of ["temperature", "top_p", "top_k"]) if (key in body) return `${key} is not supported`;
  const messages = body.messages as { role: string }[];
  if (messages[0]?.role !== "user") return "first message must be from the user";
  if (messages.some((m) => m.role === "system" || m.role === "tool")) return "system and tool go elsewhere";
  if (typeof body.max_tokens !== "number") return "max_tokens is required";
  return null;
}

const SAVED = ["ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL", "ANTHROPIC_MODEL", "RELAYDESK_JUDGE_MODEL", "RELAYDESK_STUB_LLM"];

describe("calls to the Messages API", () => {
  const saved = Object.fromEntries(SAVED.map((k) => [k, process.env[k]]));
  const requests: { path?: string; key?: string; body: Record<string, unknown> }[] = [];
  let server: Server;

  before(async () => {
    server = createServer((req, res) => {
      let raw = "";
      req.on("data", (chunk) => (raw += chunk));
      req.on("end", () => {
        const body = JSON.parse(raw) as Record<string, unknown>;
        // The SDK sends the key as a bearer token (older releases used x-api-key).
        const key = (req.headers["x-api-key"] as string | undefined) ?? req.headers.authorization?.replace(/^Bearer /, "");
        requests.push({ path: req.url, key, body });
        const rejected = rejection(body);
        res.setHeader("content-type", "application/json");
        if (rejected) {
          res.statusCode = 400;
          res.end(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: rejected } }));
          return;
        }
        // A thinking block first, as Claude sends with thinking on: only the text may reach the caller.
        const content = body.tools
          ? [{ type: "tool_use", id: "toolu_1", name: "hand_off", input: { reason: "not covered" } }]
          : [
              { type: "thinking", thinking: "", signature: "sig" },
              { type: "text", text: '{"score": 1, "reason": "ok"}' },
            ];
        res.end(
          JSON.stringify({
            id: "msg_fake",
            type: "message",
            role: "assistant",
            model: body.model,
            content,
            stop_reason: body.tools ? "tool_use" : "end_turn",
            usage: { input_tokens: 10, output_tokens: 5 },
          }),
        );
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${port}`;
    process.env.ANTHROPIC_MODEL = "claude-haiku-5-5";
    process.env.RELAYDESK_JUDGE_MODEL = "claude-sonnet-5-5";
    delete process.env.RELAYDESK_STUB_LLM;
  });

  after(() => {
    server.close();
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("sends answer and classifier calls the API accepts, and keeps only the text", async () => {
    const response = await chatModel().invoke([
      { role: "system", content: "You are a support assistant." },
      { role: "user", content: "What is the write-key rate limit?" },
    ]);
    assert.equal(response.content, '{"score": 1, "reason": "ok"}');
    assert.equal(response.usage_metadata?.input_tokens, 10);
    const last = requests.at(-1)!;
    assert.equal(last.path, "/v1/messages");
    assert.equal(last.key, "sk-ant-test");
    assert.equal(last.body.model, "claude-haiku-5-5");
    assert.equal(last.body.system, "You are a support assistant.");
  });

  it("sends the faithfulness judge to its own pinned model", async () => {
    const golden = experimentSuite().experiments.find((e) => e.key === "golden")!;
    const judge = golden.evaluators.at(-1)!;
    const result = await judge({
      input: { question: "What is the write-key rate limit?" },
      output: { answer: "See API keys.", citations: ["api-keys"], escalated: false, usedLlm: true, retrieved: [] },
      expectedOutput: { slug: "api-keys", answer: "" },
    });
    assert.deepEqual(result, { name: "faithfulness", value: 1, comment: "ok" });
    assert.equal(requests.at(-1)!.body.model, "claude-sonnet-5-5");
  });

  it("sends the agent's tool calls the API accepts", async () => {
    const turn = await anthropicToolModel(chatModelName())("You are a support assistant.", [{ role: "user", content: "hi" }], TOOLS);
    assert.deepEqual(turn.content, [{ type: "tool_use", id: "toolu_1", name: "hand_off", input: { reason: "not covered" } }]);
    assert.deepEqual((requests.at(-1)!.body.tools as { name: string }[]).map((t) => t.name), ["search_help_center", "reply", "hand_off"]);
  });
});

describe("default model", () => {
  it("is Claude Haiku 5.5 unless ANTHROPIC_MODEL says otherwise", () => {
    const saved = { model: process.env.ANTHROPIC_MODEL, stub: process.env.RELAYDESK_STUB_LLM };
    delete process.env.ANTHROPIC_MODEL;
    delete process.env.RELAYDESK_STUB_LLM;
    try {
      assert.equal(chatModelName(), "claude-haiku-5-5");
    } finally {
      for (const [key, value] of [["ANTHROPIC_MODEL", saved.model], ["RELAYDESK_STUB_LLM", saved.stub]] as const) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});
