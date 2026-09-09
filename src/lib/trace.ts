import { mkdirSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  SpanStatusCode,
  trace,
  type AttributeValue,
  type Span,
} from "@opentelemetry/api";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  NodeTracerProvider,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import type {
  ReadableSpan,
  SpanExporter,
} from "@opentelemetry/sdk-trace-base";

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

export function initTracing(): void {
  if (provider) return;
  provider = new NodeTracerProvider({
    resource: resourceFromAttributes({ "service.name": "relaydesk" }),
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  provider.register();
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
    const bits = Object.entries(row.attributes).map(([key, value]) => `${key}=${value}`);
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
  const tracer = trace.getTracer("relaydesk");
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
