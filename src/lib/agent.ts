/**
 * The agent path (#70): the model gets three tools and decides when to search,
 * search again, reply, or hand off. Written by hand against /chat/completions,
 * with no framework. answerQuestion() runs the deterministic checks first, so
 * the model can't talk its way past them.
 */
import { z } from "zod";
import { CONFIDENT_MIN_SCORE, isRefusal } from "./escalate";
import type { HelpCenter } from "./help-center";
import { retrieve, type Citation, type Hit, type RagResult } from "./rag";
import { generationAttributes, withSpan } from "./trace";

export type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };

export type AgentMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export type ModelTurn = {
  message: { content: string | null; tool_calls?: ToolCall[] };
  usage?: { input_tokens?: number; output_tokens?: number };
};

/** One call to a chat model that can return tool calls. */
export type ToolModel = (messages: AgentMessage[], tools: typeof TOOLS) => Promise<ModelTurn>;

/** Model calls per question. A model still searching after this many is handed to a person. */
export const MAX_AGENT_STEPS = 4;

export const TOOLS = [
  {
    type: "function",
    function: {
      name: "search_help_center",
      description: "Search the help center. Returns up to 3 articles with slug, title and body.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "A short search query." } },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "reply",
      description: "Send the final answer to the customer. Cite the slugs of the articles it comes from.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string" },
          article_slugs: { type: "array", items: { type: "string" } },
        },
        required: ["text", "article_slugs"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "hand_off",
      description: "Pass the question to a person when the help center doesn't answer it.",
      parameters: {
        type: "object",
        properties: { reason: { type: "string" } },
        required: ["reason"],
      },
    },
  },
] as const;

const SearchArgs = z.object({ query: z.string().trim().min(1) });
const ReplyArgs = z.object({ text: z.string().trim().min(1), article_slugs: z.array(z.string()) });
const HandOffArgs = z.object({ reason: z.string() });

export function agentSystem(businessName: string): string {
  return `You are the ${businessName} support assistant on a customer site. Use search_help_center to find help articles, and search again with other words if the first results don't answer the question. Answer only from articles you found, including what you can infer from them (for example, a feature limited to some plans is not on the others). Finish with exactly one tool call: reply with a short answer and the slugs of the articles it uses, or hand_off when the help center doesn't answer the question. Answer in English, unless the question itself is written in Tagalog or Taglish; then answer the same way. Mention article titles naturally, as written. Do not invent policies, prices, or product behavior.`;
}

/** The default model: /chat/completions on OPENAI_BASE_URL, the same endpoint the graph uses. */
export function fetchToolModel(config: {
  baseUrl?: string;
  apiKey: string;
  model: string;
  temperature?: number;
}): ToolModel {
  const url = `${(config.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "")}/chat/completions`;
  return async (messages, tools) => {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({
        model: config.model,
        messages,
        tools,
        ...(config.temperature === undefined ? {} : { temperature: config.temperature }),
      }),
    });
    if (!response.ok) throw new Error(`model call failed: ${response.status} ${(await response.text()).slice(0, 300)}`);
    const body = (await response.json()) as {
      choices: { message: ModelTurn["message"] }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    return {
      message: body.choices[0].message,
      usage: { input_tokens: body.usage?.prompt_tokens, output_tokens: body.usage?.completion_tokens },
    };
  };
}

/** Tool arguments are JSON the model wrote, so they can be malformed. */
function parseArgs<T>(schema: z.ZodType<T>, raw: string): { ok: true; value: T } | { ok: false; error: string } {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, error: "Arguments were not valid JSON." };
  }
  const parsed = schema.safeParse(json);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, error: `Invalid arguments: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}` };
}

export type AgentResult = {
  result: RagResult;
  steps: number;
  /** How the loop ended. */
  stop: "reply" | "hand_off" | "step_cap" | "no_tool_call" | "model_error";
};

/**
 * Runs the loop for one question. `fallback` is what the visitor sees when the
 * model doesn't finish with a tool (no tool call, or a failed call): the
 * graph's extractive answer, as when its own model call fails.
 */
export async function runAgent(options: {
  center: HelpCenter;
  /** What the model sees; labels earlier questions on a follow-up. */
  prompt: string;
  refuseLine: string;
  model: ToolModel;
  modelName: string;
  fallback: () => RagResult;
  maxSteps?: number;
}): Promise<AgentResult> {
  const { center, refuseLine, model } = options;
  const maxSteps = options.maxSteps ?? MAX_AGENT_STEPS;
  const messages: AgentMessage[] = [
    { role: "system", content: agentSystem(center.name) },
    { role: "user", content: options.prompt },
  ];
  // Every article the agent has seen, so a reply can only cite those.
  const seen = new Map<string, Hit>();
  const handOff = (steps: number, stop: AgentResult["stop"]): AgentResult => ({
    result: { answer: refuseLine, citations: [], confident: false, usedLlm: true, escalated: true },
    steps,
    stop,
  });

  for (let step = 1; step <= maxSteps; step++) {
    let turn: ModelTurn;
    try {
      turn = await withSpan("agent.model", { "agent.step": step }, async (span) => {
        const out = await model(messages, TOOLS);
        span.setAttributes(
          generationAttributes({
            model: options.modelName,
            input: messages.map((m) => ({
              role: m.role,
              content: m.role === "assistant" ? JSON.stringify(m.tool_calls ?? m.content) : m.content,
            })),
            output: JSON.stringify(out.message),
            usage: out.usage,
          }),
        );
        return out;
      });
    } catch {
      return { result: options.fallback(), steps: step, stop: "model_error" };
    }

    const calls = turn.message.tool_calls ?? [];
    if (calls.length === 0) {
      return { result: options.fallback(), steps: step, stop: "no_tool_call" };
    }
    messages.push({ role: "assistant", content: turn.message.content, tool_calls: calls });

    for (const call of calls) {
      const outcome = await withSpan(
        "agent.tool",
        { "agent.step": step, "tool.name": call.function.name, "tool.arguments": call.function.arguments },
        async (span) => {
          const done = (result: AgentResult) => {
            span.setAttribute("tool.result", result.stop);
            return { done: result } as const;
          };
          const toolResult = (content: string) => {
            span.setAttribute("tool.result", content.slice(0, 500));
            messages.push({ role: "tool", tool_call_id: call.id, content });
            return { done: undefined } as const;
          };

          switch (call.function.name) {
            case "search_help_center": {
              const args = parseArgs(SearchArgs, call.function.arguments);
              if (!args.ok) return toolResult(args.error);
              const hits = retrieve(args.value.query, { corpus: center.corpus });
              for (const hit of hits) if (!seen.has(hit.article.slug)) seen.set(hit.article.slug, hit);
              span.setAttribute("retrieve.slugs", hits.map((h) => h.article.slug).join(","));
              if (hits.length === 0) return toolResult("No articles matched. Try other words.");
              return toolResult(
                JSON.stringify(hits.map((h) => ({ slug: h.article.slug, title: h.article.title, body: h.article.body }))),
              );
            }
            case "reply": {
              const args = parseArgs(ReplyArgs, call.function.arguments);
              if (!args.ok) return toolResult(args.error);
              if (isRefusal(args.value.text)) return done(handOff(step, "hand_off"));
              const cited = [...new Set(args.value.article_slugs)].flatMap((slug) => seen.get(slug) ?? []);
              span.setAttribute("reply.dropped_slugs", args.value.article_slugs.filter((s) => !seen.has(s)).join(","));
              if (cited.length === 0) {
                return toolResult("Cite at least one article slug returned by search_help_center, or call hand_off.");
              }
              const citations: Citation[] = cited.map((h) => ({ slug: h.article.slug, title: h.article.title }));
              return done({
                result: {
                  answer: args.value.text,
                  citations,
                  confident: Math.max(...cited.map((h) => h.score)) >= CONFIDENT_MIN_SCORE,
                  usedLlm: true,
                  escalated: false,
                },
                steps: step,
                stop: "reply",
              });
            }
            case "hand_off": {
              const args = parseArgs(HandOffArgs, call.function.arguments);
              if (!args.ok) return toolResult(args.error);
              span.setAttribute("hand_off.reason", args.value.reason);
              return done(handOff(step, "hand_off"));
            }
            default:
              return toolResult(`Unknown tool ${call.function.name}. Use search_help_center, reply, or hand_off.`);
          }
        },
      );
      if (outcome.done) return outcome.done;
    }
  }
  return handOff(maxSteps, "step_cap");
}
