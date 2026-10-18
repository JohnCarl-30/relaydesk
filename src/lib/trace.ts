import { mkdirSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  SpanStatusCode,
  trace,
  type AttributeValue,
  type Span,
} from "@opentelemetry/api";
import {
  isDefaultExportSpan,
  LangfuseSpanProcessor,
  type ShouldExportSpan,
} from "@langfuse/otel";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  NodeTracerProvider,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import type {
  ReadableSpan,
  SpanExporter,
  SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { redactText } from "./redact";

const TRACER_NAME = "relaydesk";

export type SpanDump = {
  name: string;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  durationMs: number;
  attributes: Record<string, string | number | boolean>;
};

const finished: ReadableSpan[] = [];
let provider: NodeTracerProvider | undefined;

function defaultTraceFile(): string | null {
  if (process.env.RELAYDESK_TRACE_FILE === "0") return null;
  if (process.env.RELAYDESK_TRACE_FILE) return process.env.RELAYDESK_TRACE_FILE;
  return join(process.cwd(), "eval/traces/live.jsonl");
}

function writeJsonl(spans: ReadableSpan[]): void {
  const file = defaultTraceFile();
  if (!file) return;
  try {
    mkdirSync(dirname(file), { recursive: true });
    for (const span of dumpSpans(spans)) {
      appendFileSync(file, `${JSON.stringify(span)}\n`);
    }
  } catch {
    // Local file is best-effort. The in-memory snapshot still works.
  }
}

function hrTimeToMs(hrTime: readonly number[]): number {
  return hrTime[0] * 1e3 + hrTime[1] / 1e6;
}

const exporter: SpanExporter = {
  export(spans: ReadableSpan[], resultCallback) {
    finished.push(...spans);
    writeJsonl(spans);
    resultCallback({ code: 0 });
  },
  shutdown() {
    return Promise.resolve();
  },
  forceFlush() {
    return Promise.resolve();
  },
};

/**
 * Runs first, so the local file, the in-memory snapshot, and Langfuse all see
 * redacted text. Spans are mutable until every processor's onEnd has run.
 */
class RedactingSpanProcessor implements SpanProcessor {
  onStart(): void {}
  onEnd(span: ReadableSpan): void {
    const attributes = span.attributes as Record<string, AttributeValue | undefined>;
    for (const [key, value] of Object.entries(attributes)) {
      if (typeof value === "string") {
        attributes[key] = redactText(value);
      } else if (Array.isArray(value)) {
        attributes[key] = value.map((item) =>
          typeof item === "string" ? redactText(item) : item,
        ) as AttributeValue;
      }
    }
  }
  forceFlush(): Promise<void> {
    return Promise.resolve();
  }
  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}

/** Langfuse's default (its own and GenAI spans) plus every relaydesk span. */
export const shouldExportToLangfuse: ShouldExportSpan = ({ otelSpan }) =>
  otelSpan.instrumentationScope.name === TRACER_NAME || isDefaultExportSpan(otelSpan);

type LangfuseEnv = Record<string, string | undefined>;

/** Sends spans to Langfuse only when both keys are set. */
export function langfuseProcessor(env: LangfuseEnv = process.env): LangfuseSpanProcessor | undefined {
  if (!env.LANGFUSE_PUBLIC_KEY || !env.LANGFUSE_SECRET_KEY) return undefined;
  return new LangfuseSpanProcessor({
    publicKey: env.LANGFUSE_PUBLIC_KEY,
    secretKey: env.LANGFUSE_SECRET_KEY,
    baseUrl: env.LANGFUSE_BASE_URL,
    shouldExportSpan: shouldExportToLangfuse,
  });
}

export function initTracing(): void {
  if (provider) return;
  const langfuse = langfuseProcessor();
  provider = new NodeTracerProvider({
    resource: resourceFromAttributes({ "service.name": "relaydesk" }),
    spanProcessors: [
      new RedactingSpanProcessor(),
      new SimpleSpanProcessor(exporter),
      ...(langfuse ? [langfuse] : []),
    ],
  });
  provider.register();
}

type ChatMessage = { role: string; content: string };

/**
 * Marks a span as one model call. Model and token names follow the
 * OpenTelemetry GenAI conventions; input and output use Langfuse's names.
 */
export function generationAttributes(call: {
  model: string;
  input: ChatMessage[];
  output: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}): Record<string, string | number> {
  return {
    "langfuse.observation.type": "generation",
    "gen_ai.request.model": call.model,
    "gen_ai.usage.input_tokens": call.usage?.input_tokens ?? 0,
    "gen_ai.usage.output_tokens": call.usage?.output_tokens ?? 0,
    "langfuse.observation.input": JSON.stringify(call.input),
    "langfuse.observation.output": call.output,
  };
}

export async function flushTracing(): Promise<void> {
  await provider?.forceFlush();
}

export function snapshotSpans(): ReadableSpan[] {
  return [...finished];
}

export function resetSpans(): void {
  finished.length = 0;
}

export function dumpSpans(spans: ReadableSpan[] = finished): SpanDump[] {
  return spans.map((span) => {
    const attrs: Record<string, string | number | boolean> = {};
    for (const [key, value] of Object.entries(span.attributes)) {
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        attrs[key] = value;
      }
    }
    return {
      name: span.name,
      traceId: span.spanContext().traceId,
      spanId: span.spanContext().spanId,
      parentSpanId: span.parentSpanContext?.spanId,
      durationMs: Math.round(hrTimeToMs(span.duration) * 10) / 10,
      attributes: attrs,
    };
  });
}

export function spansForTrace(traceId: string, spans: ReadableSpan[] = finished): ReadableSpan[] {
  return spans.filter((span) => span.spanContext().traceId === traceId);
}

export function latestTraceId(spans: ReadableSpan[] = finished): string | undefined {
  for (let i = spans.length - 1; i >= 0; i -= 1) {
    if (spans[i].name === "support.answer") return spans[i].spanContext().traceId;
  }
  return spans.at(-1)?.spanContext().traceId;
}

/** Full prompts and answers stay in the JSON dump; the tree stays one line per span. */
const TREE_HIDDEN = new Set(["langfuse.observation.input", "langfuse.observation.output"]);

export function formatTree(dumps: SpanDump[]): string {
  const children = new Map<string, SpanDump[]>();
  const roots: SpanDump[] = [];
  const ids = new Set(dumps.map((row) => row.spanId));
  for (const row of dumps) {
    if (row.parentSpanId && ids.has(row.parentSpanId)) {
      const list = children.get(row.parentSpanId) ?? [];
      list.push(row);
      children.set(row.parentSpanId, list);
    } else {
      roots.push(row);
    }
  }

  const lines: string[] = [];
  const walk = (row: SpanDump, depth: number) => {
    const bits = Object.entries(row.attributes)
      .filter(([key]) => !TREE_HIDDEN.has(key))
      .map(([key, value]) => `${key}=${value}`);
    const extra = bits.length ? `  ${bits.join(" ")}` : "";
    lines.push(`${"  ".repeat(depth)}${row.name.padEnd(16)} ${String(row.durationMs).padStart(6)}ms${extra}`);
    for (const child of children.get(row.spanId) ?? []) walk(child, depth + 1);
  };
  for (const root of roots) walk(root, 0);
  return lines.join("\n");
}

export async function withSpan<T>(
  name: string,
  attrs: Record<string, AttributeValue | undefined>,
  fn: (span: Span) => T | Promise<T>,
): Promise<T> {
  initTracing();
  const tracer = trace.getTracer(TRACER_NAME);
  return tracer.startActiveSpan(name, async (span) => {
    for (const [key, value] of Object.entries(attrs)) {
      if (value !== undefined) span.setAttribute(key, value);
    }
    try {
      return await fn(span);
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw err;
    } finally {
      span.end();
    }
  });
}
