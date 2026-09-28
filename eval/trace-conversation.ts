/**
 * Print OpenTelemetry spans for one extractive pass and one rewrite pass.
 *
 *   npx --yes tsx eval/trace-conversation.ts
 *
 * OPENAI_API_KEY uses the real model. Without it, RELAYDESK_STUB_LLM=1 walks
 * generate → rewrite → retrieve → generate so you can still open the tree.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { answerQuestion } from "../src/lib/graph";
import { forceExtractiveAnswers } from "../src/lib/keyless";
import {
  dumpSpans,
  flushTracing,
  formatTree,
  latestTraceId,
  resetSpans,
  snapshotSpans,
  spansForTrace,
  type SpanDump,
} from "../src/lib/trace";

const QUESTION = "what is nimbus";
const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "traces");

type Capture = {
  capturedAt: string;
  question: string;
  mode: "extractive" | "llm";
  stub: boolean;
  usedLlm: boolean;
  confident: boolean;
  tree: string;
  spans: SpanDump[];
};

async function capture(mode: "extractive" | "llm"): Promise<Capture> {
  resetSpans();
  const apiKey = process.env.OPENAI_API_KEY;
  const stub = mode === "llm" && !apiKey;
  if (mode === "extractive") {
    // graph.ts calls the model whenever a key is set, so hide it for this pass.
    forceExtractiveAnswers();
  } else if (stub) {
    process.env.RELAYDESK_STUB_LLM = "1";
  }
  let rag;
  try {
    rag = await answerQuestion(QUESTION);
  } finally {
    if (apiKey !== undefined) process.env.OPENAI_API_KEY = apiKey;
  }
  await flushTracing();
  const traceId = latestTraceId(snapshotSpans());
  if (!traceId) throw new Error("no support.answer span");
  const spans = dumpSpans(spansForTrace(traceId));
  return {
    capturedAt: new Date().toISOString().slice(0, 10),
    question: QUESTION,
    mode,
    stub,
    usedLlm: rag.usedLlm,
    confident: rag.confident,
    tree: formatTree(spans),
    spans,
  };
}

function writeCapture(name: string, capture: Capture): void {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, `${name}.json`), `${JSON.stringify(capture, null, 2)}\n`);
  writeFileSync(join(outDir, `${name}.txt`), `${capture.tree}\n`);
}

async function main() {
  process.env.RELAYDESK_TRACE_FILE = "0";
  const extractive = await capture("extractive");
  writeCapture("extractive", extractive);
  const llm = await capture("llm");
  writeCapture("llm-rewrite", llm);

  console.log("Same question:", QUESTION);
  console.log("\n--- extractive (no key, rewrite skipped) ---\n");
  console.log(extractive.tree);
  console.log("\n--- llm path (stub=" + llm.stub + ") ---\n");
  console.log(llm.tree);
  console.log(`\nWrote ${join(outDir, "extractive.txt")} and ${join(outDir, "llm-rewrite.txt")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
