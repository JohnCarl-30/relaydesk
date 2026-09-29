import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import {
  ACKNOWLEDGEMENT_REPLY,
  boundConversationHistory,
  heuristicStandaloneQuestion,
  isAcknowledgement,
  needsConversationContext,
  preferTopic,
  unsupportedExplicitAnchors,
  type ConversationTurn,
} from "./conversation-context";
import {
  CONFIDENT_MIN_SCORE,
  isVisitorEscalation,
  REFUSE_LINE,
  shouldEscalate,
  unsupportedPriceQuestion,
} from "./escalate";
import {
  extractiveAnswer,
  retrieve,
  type Citation,
  type Hit,
  type RagResult,
} from "./rag";
import { initTracing, withSpan } from "./trace";

/** The visitor's question and the forms the graph uses it in. */
type ResolvedQuestion = {
  /** What the visitor typed. */
  asked: string;
  /** Plain text for retrieval, coverage, and extractive answers. */
  search: string;
  /** What the model sees. Labels earlier questions when contextualized. */
  prompt: string;
  /** True when earlier questions were folded in. */
  contextualized: boolean;
  /** Top article for the chain's first question, when contextualized. */
  topicSlug?: string;
};

function asAsked(question: string): ResolvedQuestion {
  return { asked: question, search: question, prompt: question, contextualized: false };
}

const SupportState = Annotation.Root({
  resolved: Annotation<ResolvedQuestion>,
  query: Annotation<string>,
  hits: Annotation<Hit[]>,
  answer: Annotation<string>,
  citations: Annotation<Citation[]>({
    reducer: (_left, right) => right,
    default: () => [],
  }),
  confident: Annotation<boolean>,
  usedLlm: Annotation<boolean>,
  escalated: Annotation<boolean>,
  attempts: Annotation<number>({
    reducer: (_left, right) => right,
    default: () => 0,
  }),
  allowRewrite: Annotation<boolean>({
    reducer: (_left, right) => right,
    default: () => true,
  }),
});

type SupportStateType = typeof SupportState.State;

type ChatResponse = {
  content: unknown;
  usage_metadata?: { input_tokens?: number; output_tokens?: number };
};

type ChatLike = {
  invoke: (messages: { role: string; content: string }[]) => Promise<ChatResponse>;
};

/** Placeholder tokens so a stub rewrite path still has llm.* attributes. Real keys overwrite these. */
class StubChatModel implements ChatLike {
  private index = 0;
  constructor(private replies: string[]) {}
  async invoke(): Promise<ChatResponse> {
    const content = this.replies[this.index] ?? this.replies.at(-1) ?? "";
    this.index += 1;
    return {
      content,
      usage_metadata: { input_tokens: 48, output_tokens: 32 },
    };
  }
}

const GENERATE_SYSTEM =
  "You are the Nimbus support assistant on a customer site. Answer only from the provided help articles. Be short. If the articles do not contain the answer, say you are unsure and suggest talking to a human. Mention article titles naturally. Do not invent policies, prices, or product behavior.";

function hasLlm(): boolean {
  return Boolean(process.env.OPENAI_API_KEY) || process.env.RELAYDESK_STUB_LLM === "1";
}

function usingStubLlm(): boolean {
  return !process.env.OPENAI_API_KEY && process.env.RELAYDESK_STUB_LLM === "1";
}

let stubSession: StubChatModel | undefined;

function chatModel(): ChatLike {
  if (usingStubLlm()) {
    stubSession ??= new StubChatModel([
      "Nimbus is the analytics product in the help center. I am not fully sure. Talk to a person if this is the wrong case.",
      "nimbus workspace definition",
      "A Nimbus workspace holds your projects, teammates, and bill. Event data never crosses workspaces.",
    ]);
    return stubSession;
  }
  const base = process.env.OPENAI_BASE_URL?.replace(/\/$/, "");
  return new ChatOpenAI({
    model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
    temperature: 0.2,
    apiKey: process.env.OPENAI_API_KEY,
    ...(base ? { configuration: { baseURL: base } } : {}),
  }) as ChatLike;
}

function resolveQuestion(
  question: string,
  history: ConversationTurn[],
): ResolvedQuestion {
  const bounded = boundConversationHistory(history);
  // Escalation requests take the same path; answerFromHits refuses them either way.
  if (!needsConversationContext(question, bounded)) return asAsked(question);

  const standalone = heuristicStandaloneQuestion(question, bounded);
  if (!standalone) return asAsked(question);
  return {
    asked: question,
    search: standalone.search,
    prompt: standalone.prompt,
    contextualized: true,
    topicSlug: retrieve(standalone.topic)[0]?.article.slug,
  };
}

function nextAfterGenerate(state: SupportStateType): "rewrite" | "END" {
  if (state.allowRewrite === false) return "END";
  if (state.escalated || state.confident || (state.attempts ?? 0) >= 2) return "END";
  if (!hasLlm()) return "END";
  return "rewrite";
}

function tokenAttrs(response: ChatResponse): Record<string, number> {
  return {
    "llm.input_tokens": response.usage_metadata?.input_tokens ?? 0,
    "llm.output_tokens": response.usage_metadata?.output_tokens ?? 0,
  };
}

async function retrieveNode(state: SupportStateType) {
  const query = state.query?.trim() || state.resolved.search;
  return withSpan("retrieve", { "retrieve.query": query }, (span) => {
    const retrieved = retrieve(query);
    const { contextualized, topicSlug, asked } = state.resolved;
    const hits = contextualized ? preferTopic(retrieved, topicSlug, asked) : retrieved;
    span.setAttribute("retrieve.topic_slug", topicSlug ?? "");
    span.setAttribute("retrieve.kept_topic", hits[0] !== retrieved[0]);
    span.setAttribute("retrieve.hit_count", hits.length);
    span.setAttribute("retrieve.top_slug", hits[0]?.article.slug ?? "");
    span.setAttribute("retrieve.top_score", hits[0]?.score ?? 0);
    span.setAttribute("retrieve.slugs", hits.map((hit) => hit.article.slug).join(","));
    return { hits };
  });
}

type SpanAttrs = Record<string, string | number | boolean>;

/**
 * Refusal checks, then the model when one is configured, else an extractive
 * quote. The widget's generate node and eval/generate.ts both call this, so
 * the A/B measures what the widget runs.
 */
async function answerFromHits(
  resolved: ResolvedQuestion,
  hits: Hit[],
): Promise<{ result: RagResult; attrs: SpanAttrs }> {
  const explicitEscalation = isVisitorEscalation(resolved.asked);
  const unsupportedAnchors = resolved.contextualized
    ? unsupportedExplicitAnchors(resolved.asked, hits)
    : [];
  const unpricedQuestion = unsupportedPriceQuestion(resolved.asked, hits[0]);
  const attrs: SpanAttrs = {
    "generate.explicit_escalation": explicitEscalation,
    "generate.unsupported_anchors": unsupportedAnchors.join(","),
    "generate.unsupported_price": unpricedQuestion,
  };

  if (explicitEscalation || unsupportedAnchors.length > 0 || unpricedQuestion) {
    return {
      result: {
        answer: REFUSE_LINE,
        citations: [],
        confident: false,
        usedLlm: false,
        escalated: true,
      },
      attrs,
    };
  }

  const extractive = () =>
    extractiveAnswer(resolved.search, hits, {
      focus: resolved.contextualized ? resolved.asked : undefined,
    });

  if (!hasLlm() || hits.length === 0 || shouldEscalate(resolved.search, hits)) {
    return { result: extractive(), attrs };
  }

  const context = hits
    .map((h, i) => `[${i + 1}] ${h.article.title}\n${h.article.body}`)
    .join("\n\n");

  try {
    const response = await chatModel().invoke([
      { role: "system", content: GENERATE_SYSTEM },
      {
        role: "user",
        content: `Question: ${resolved.prompt}\n\nHelp articles:\n${context}`,
      },
    ]);
    Object.assign(attrs, tokenAttrs(response));
    const text =
      typeof response.content === "string" ? response.content.trim() : "";
    if (!text) return { result: extractive(), attrs };
    return {
      result: {
        answer: text,
        citations: hits.map((h) => ({
          slug: h.article.slug,
          title: h.article.title,
        })),
        confident: (hits[0]?.score ?? 0) >= CONFIDENT_MIN_SCORE,
        usedLlm: true,
        escalated: false,
      },
      attrs,
    };
  } catch {
    return { result: extractive(), attrs };
  }
}

async function generateNode(state: SupportStateType) {
  const hits = state.hits ?? [];
  const attempts = (state.attempts ?? 0) + 1;
  return withSpan(
    "generate",
    { "generate.attempts": attempts, "llm.stub": usingStubLlm() },
    async (span) => {
      const { result, attrs } = await answerFromHits(state.resolved, hits);
      for (const [key, value] of Object.entries(attrs)) span.setAttribute(key, value);
      const patch = { ...result, attempts };
      const next = nextAfterGenerate({ ...state, ...patch } as SupportStateType);
      span.setAttribute("generate.used_llm", Boolean(patch.usedLlm));
      span.setAttribute("generate.confident", Boolean(patch.confident));
      span.setAttribute("generate.escalated", Boolean(patch.escalated));
      span.setAttribute("generate.attempts", patch.attempts);
      span.setAttribute("graph.next", next);
      return patch;
    },
  );
}

async function rewriteNode(state: SupportStateType) {
  return withSpan("rewrite", { "llm.stub": usingStubLlm() }, async (span) => {
    const response = await chatModel().invoke([
      {
        role: "system",
        content:
          "Rewrite the visitor question as a short help-center search query. Return only the query. Keep product words like seats, SSO, invoice, funnel, API key.",
      },
      { role: "user", content: state.resolved.prompt },
    ]);
    const tokens = tokenAttrs(response);
    span.setAttribute("llm.input_tokens", tokens["llm.input_tokens"]);
    span.setAttribute("llm.output_tokens", tokens["llm.output_tokens"]);
    const query =
      typeof response.content === "string" && response.content.trim()
        ? response.content.trim()
        : state.resolved.search;
    span.setAttribute("rewrite.query", query);
    span.setAttribute("graph.next", "retrieve");
    return { query };
  });
}

function afterGenerate(state: SupportStateType): "rewrite" | typeof END {
  return nextAfterGenerate(state) === "rewrite" ? "rewrite" : END;
}

function buildGraph() {
  return new StateGraph(SupportState)
    .addNode("retrieve", retrieveNode)
    .addNode("generate", generateNode)
    .addNode("rewrite", rewriteNode)
    .addEdge(START, "retrieve")
    .addEdge("retrieve", "generate")
    .addConditionalEdges("generate", afterGenerate, {
      rewrite: "rewrite",
      [END]: END,
    })
    .addEdge("rewrite", "retrieve")
    .compile();
}

let graph: ReturnType<typeof buildGraph> | undefined;

function supportGraph() {
  graph ??= buildGraph();
  return graph;
}

/** eval/generate.ts: the widget's answer step for one standalone question. */
export async function generateFromHits(
  question: string,
  hits: Hit[],
): Promise<RagResult> {
  return (await answerFromHits(asAsked(question), hits)).result;
}

export async function answerQuestion(
  question: string,
  options: { rewrite?: boolean; history?: ConversationTurn[] } = {},
): Promise<RagResult> {
  initTracing();
  stubSession = undefined;
  return withSpan("support.answer", { question }, async (span) => {
    const acknowledgement = isAcknowledgement(question);
    span.setAttribute("acknowledgement", acknowledgement);
    if (acknowledgement) {
      return {
        answer: ACKNOWLEDGEMENT_REPLY,
        citations: [],
        confident: false,
        usedLlm: false,
        escalated: false,
      };
    }

    const resolved = resolveQuestion(question, options.history ?? []);
    span.setAttribute("contextualized", resolved.contextualized);
    span.setAttribute("resolved.search", resolved.search);
    const state = await supportGraph().invoke({
      resolved,
      allowRewrite: options.rewrite !== false,
    });
    span.setAttribute("usedLlm", Boolean(state.usedLlm));
    span.setAttribute("attempts", state.attempts ?? 0);
    span.setAttribute("confident", Boolean(state.confident));
    span.setAttribute("escalated", Boolean(state.escalated));
    span.setAttribute("rewrite.allowed", options.rewrite !== false);
    span.setAttribute("graph.next", "END");
    span.setAttribute("citation_count", (state.citations ?? []).length);
    return {
      answer: state.answer,
      citations: state.citations ?? [],
      confident: Boolean(state.confident),
      usedLlm: Boolean(state.usedLlm),
      escalated: Boolean(state.escalated),
    };
  });
}
