import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { chatModel, temperatureFor } from "../src/lib/graph";
import { experimentSuite } from "./suite";

// #56/#57 run Claude through Anthropic's OpenAI-compatible endpoint by pointing OPENAI_* at it.
// This fake enforces the request rules that endpoint documents for Claude 4.7 and later
// (https://platform.claude.com/docs/en/api/openai-sdk), so a request it would 400 fails here first.
function compatRejection(body: Record<string, unknown>): string | null {
  const { temperature, top_p, n, response_format } = body;
  if (temperature !== undefined && top_p !== undefined) return "temperature and top_p together";
  if (typeof temperature === "number" && temperature < 1) return `temperature ${temperature} below 1`;
  if (top_p !== undefined && top_p !== 0.99) return `top_p ${top_p}`;
  if (n !== undefined && n !== 1) return `n ${n}`;
  const format = response_format as { type?: string; json_schema?: { strict?: boolean } } | undefined;
  if (format && !(format.type === "json_schema" && format.json_schema?.strict)) return "response_format";
  return null;
}

const SAVED = ["OPENAI_API_KEY", "OPENAI_BASE_URL", "OPENAI_MODEL", "RELAYDESK_JUDGE_MODEL", "RELAYDESK_STUB_LLM"];

describe("Claude through the OpenAI-compatible endpoint", () => {
  const saved = Object.fromEntries(SAVED.map((k) => [k, process.env[k]]));
  const requests: { path?: string; auth?: string; body: Record<string, unknown> }[] = [];
  let server: Server;

  before(async () => {
    server = createServer((req, res) => {
      let raw = "";
      req.on("data", (chunk) => (raw += chunk));
      req.on("end", () => {
        const body = JSON.parse(raw) as Record<string, unknown>;
        requests.push({ path: req.url, auth: req.headers.authorization, body });
        const rejected = compatRejection(body);
        res.setHeader("content-type", "application/json");
        if (rejected) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: { type: "invalid_request_error", message: rejected } }));
          return;
        }
        res.end(
          JSON.stringify({
            id: "msg_fake",
            object: "chat.completion",
            created: 0,
            model: body.model,
            choices: [
              { index: 0, message: { role: "assistant", content: '{"score": 1, "reason": "ok"}' }, finish_reason: "stop" },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          }),
        );
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    process.env.OPENAI_API_KEY = "sk-ant-test";
    process.env.OPENAI_BASE_URL = `http://127.0.0.1:${port}/v1/`;
    process.env.OPENAI_MODEL = "claude-haiku-5-5";
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

  it("sends the answer and classifier calls in a shape the endpoint accepts", async () => {
    for (const model of [chatModel(), chatModel(0)]) {
      const response = await model.invoke([
        { role: "system", content: "You are a support assistant." },
        { role: "user", content: "What is the write-key rate limit?" },
      ]);
      assert.equal(typeof response.content, "string");
      assert.equal(response.usage_metadata?.input_tokens, 10);
    }
    assert.deepEqual(temperatureFor("gpt-4o-mini", 0.2), { temperature: 0.2 });
    const last = requests.at(-1)!;
    assert.equal(last.body.temperature, undefined);
    assert.equal(last.path, "/v1/chat/completions");
    assert.equal(last.auth, "Bearer sk-ant-test");
    assert.equal(last.body.model, "claude-haiku-5-5");
  });

  it("sends the faithfulness judge to its own pinned model in a shape the endpoint accepts", async () => {
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
});

