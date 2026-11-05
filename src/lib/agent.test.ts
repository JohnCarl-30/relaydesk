import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MAX_AGENT_STEPS, runAgent, type AgentMessage, type ModelTurn, type ToolModel } from "./agent";
import { REFUSE_LINE } from "./escalate";
import { answerQuestion } from "./graph";
import { DEMO_HELP_CENTER } from "./help-center";
import { forceExtractiveAnswers } from "./keyless";
import { dumpSpans, resetSpans, snapshotSpans } from "./trace";

forceExtractiveAnswers();

type Turn = ModelTurn["message"];

const call = (name: string, args: unknown, id = name): Turn => ({
  content: null,
  tool_calls: [
    { id, type: "function", function: { name, arguments: typeof args === "string" ? args : JSON.stringify(args) } },
  ],
});

/** Plays back one turn per model call, repeating the last, and records what the model was sent. */
function scripted(turns: Turn[]): ToolModel & { sent: AgentMessage[][] } {
  const sent: AgentMessage[][] = [];
  const model: ToolModel = async (messages) => {
    sent.push(structuredClone(messages));
    return { message: turns[Math.min(sent.length - 1, turns.length - 1)], usage: { input_tokens: 10, output_tokens: 5 } };
  };
  return Object.assign(model, { sent });
}

const FALLBACK = { answer: "fallback", citations: [], confident: false, usedLlm: false, escalated: false };

function run(model: ToolModel) {
  return runAgent({
    center: DEMO_HELP_CENTER,
    prompt: "Does event data cross workspaces?",
    refuseLine: REFUSE_LINE,
    model,
    modelName: "fake",
    fallback: () => FALLBACK,
  });
}

/** The tool results the model got back on its last call. */
const toolResults = (model: { sent: AgentMessage[][] }) =>
  model.sent.at(-1)!.flatMap((m) => (m.role === "tool" ? [m.content] : []));

describe("runAgent", () => {
  it("searches, then replies citing what it found", async () => {
    const model = scripted([
      call("search_help_center", { query: "workspace event data" }),
      call("reply", { text: "No, event data never crosses workspaces.", article_slugs: ["workspaces"] }),
    ]);
    const { result, steps, stop } = await run(model);
    assert.equal(stop, "reply");
    assert.equal(steps, 2);
    assert.equal(result.answer, "No, event data never crosses workspaces.");
    assert.deepEqual(result.citations.map((c) => c.slug), ["workspaces"]);
    assert.equal(result.usedLlm, true);
    assert.equal(result.escalated, false);
    assert.match(toolResults(model)[0], /"slug":"workspaces"/);
  });

  it("hands off straight away", async () => {
    const { result, steps, stop } = await run(scripted([call("hand_off", { reason: "not covered" })]));
    assert.deepEqual([stop, steps, result.answer, result.escalated], ["hand_off", 1, REFUSE_LINE, true]);
  });

  it("hands off when the model is still searching at the step cap", async () => {
    const model = scripted([call("search_help_center", { query: "workspace" })]);
    const { result, steps, stop } = await run(model);
    assert.deepEqual([stop, steps, result.escalated], ["step_cap", MAX_AGENT_STEPS, true]);
    assert.equal(model.sent.length, MAX_AGENT_STEPS);
  });

  it("returns malformed arguments to the model as errors it can recover from", async () => {
    const model = scripted([
      call("search_help_center", "{query: workspace"),
      call("search_help_center", { q: "workspace" }),
      call("search_help_center", { query: "workspace" }),
      call("reply", { text: "Event data never crosses workspaces.", article_slugs: ["workspaces"] }),
    ]);
    const { result, stop } = await run(model);
    assert.equal(stop, "reply");
    assert.deepEqual(result.citations.map((c) => c.slug), ["workspaces"]);
    const [badJson, missingField] = toolResults(model);
    assert.equal(badJson, "Arguments were not valid JSON.");
    assert.match(missingField, /^Invalid arguments: query/);
  });

  it("drops citations it never retrieved, and rejects a reply left with none", async () => {
    const model = scripted([
      call("search_help_center", { query: "workspace" }),
      call("reply", { text: "Yes.", article_slugs: ["made-up"] }),
      call("reply", { text: "No, it never crosses.", article_slugs: ["workspaces", "made-up"] }),
    ]);
    const { result, stop } = await run(model);
    assert.equal(stop, "reply");
    assert.deepEqual(result.citations.map((c) => c.slug), ["workspaces"]);
    assert.match(toolResults(model)[1], /^Cite at least one article slug/);
  });

  it("treats a reply carrying the refuse line as a hand-off", async () => {
    const { result, stop } = await run(
      scripted([call("search_help_center", { query: "x" }), call("reply", { text: REFUSE_LINE, article_slugs: [] })]),
    );
    assert.deepEqual([stop, result.escalated], ["hand_off", true]);
  });

  it("falls back to the extractive answer on plain text or a failed model call", async () => {
    const plain = await run(scripted([{ content: "Event data never crosses workspaces." }]));
    assert.deepEqual([plain.stop, plain.result], ["no_tool_call", FALLBACK]);
    const failed = await run(async () => {
      throw new Error("429");
    });
    assert.deepEqual([failed.stop, failed.result], ["model_error", FALLBACK]);
  });

  it("answers an unknown tool with an error", async () => {
    const model = scripted([call("delete_everything", {}), call("hand_off", { reason: "stuck" })]);
    await run(model);
    assert.match(toolResults(model)[0], /^Unknown tool delete_everything/);
  });
});

describe("answerQuestion with the agent path", () => {
  it("runs the deterministic checks before the model sees anything", async () => {
    const model = scripted([call("reply", { text: "Sure, here's a person.", article_slugs: [] })]);
    const result = await answerQuestion("I'd like to talk to a person", { path: "agent", agentModel: model });
    assert.equal(result.answer, REFUSE_LINE);
    assert.equal(result.escalated, true);
    assert.equal(model.sent.length, 0);
  });

  it("answers through the agent when asked", async () => {
    const model = scripted([
      call("search_help_center", { query: "workspace" }),
      call("reply", { text: "Event data never crosses workspaces.", article_slugs: ["workspaces"] }),
    ]);
    resetSpans();
    const result = await answerQuestion("Does event data cross workspaces?", { path: "agent", agentModel: model });
    assert.equal(result.answer, "Event data never crosses workspaces.");
    assert.equal(model.sent.length, 2);

    // One span per model call and per tool call, all under support.answer.
    const spans = dumpSpans(snapshotSpans());
    const root = spans.find((s) => s.name === "support.answer")!;
    assert.deepEqual(root.attributes["answer.path"], "agent");
    assert.deepEqual([root.attributes["agent.steps"], root.attributes["agent.stop"]], [2, "reply"]);
    const steps = spans.filter((s) => s.parentSpanId === root.spanId).map((s) => s.name);
    assert.deepEqual(steps, ["agent.model", "agent.tool", "agent.model", "agent.tool"]);
    const tools = spans.filter((s) => s.name === "agent.tool").map((s) => s.attributes["tool.name"]);
    assert.deepEqual(tools, ["search_help_center", "reply"]);
    assert.equal(spans.find((s) => s.name === "agent.model")!.attributes["langfuse.observation.type"], "generation");
  });

  it("keeps the graph as the default, and without a model", async () => {
    const graph = await answerQuestion("Does event data cross workspaces?");
    assert.deepEqual(await answerQuestion("Does event data cross workspaces?", { path: "agent" }), graph);
  });
});
