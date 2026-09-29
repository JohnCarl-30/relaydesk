/**
 * Latency, tokens, and $ for the Nimbus golden set.
 *
 *   npx --yes tsx eval/bench.ts
 *
 * Extractive path is retrieve + extractiveAnswer, the widget's keyless answer.
 * LLM $ is estimated from prompt size at gpt-4o-mini list prices. No live key required.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { extractiveAnswer, retrieve } from "../src/lib/rag";
import { answerQuestion } from "../src/lib/graph";
import { forceExtractiveAnswers } from "../src/lib/keyless";
import { loadGolden } from "./golden";

const GENERATE_SYSTEM =
  "You are the Nimbus support assistant on a customer site. Answer only from the provided help articles. Be short. If the articles do not contain the answer, say you are unsure and suggest talking to a human. Mention article titles naturally. Do not invent policies, prices, or product behavior.";
const REWRITE_SYSTEM =
  "Rewrite the visitor question as a short help-center search query. Return only the query. Keep product words like seats, SSO, invoice, funnel, API key.";

const INPUT_PER_M = 0.15;
const OUTPUT_PER_M = 0.6;
const GEN_OUT_TOKENS = 120;
const REWRITE_OUT_TOKENS = 12;

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function stats(ms: number[]) {
  const sorted = [...ms].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    n: sorted.length,
    mean: sum / sorted.length,
    p50: pct(sorted, 50),
    p95: pct(sorted, 95),
    max: sorted[sorted.length - 1],
  };
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function usd(inputTokens: number, outputTokens: number): number {
  return (inputTokens * INPUT_PER_M + outputTokens * OUTPUT_PER_M) / 1e6;
}

function generatePrompt(question: string, hits: { article: { title: string; body: string } }[]): string {
  const context = hits
    .map((h, i) => `[${i + 1}] ${h.article.title}\n${h.article.body}`)
    .join("\n\n");
  return `${GENERATE_SYSTEM}\nQuestion: ${question}\n\nHelp articles:\n${context}`;
}

async function timeMs(fn: () => void | Promise<void>): Promise<number> {
  const start = performance.now();
  await fn();
  return performance.now() - start;
}

async function main() {
  forceExtractiveAnswers();

  const here = dirname(fileURLToPath(import.meta.url));
  const rows = loadGolden(join(here, "golden.csv"));

  for (let i = 0; i < 5; i += 1) {
    extractiveAnswer(rows[0].question, retrieve(rows[0].question));
  }

  const extractiveMs: number[] = [];
  const graphMs: number[] = [];
  let rewriteRows = 0;
  let llmInput = 0;
  let llmOutput = 0;
  let contextChars = 0;

  for (const row of rows) {
    extractiveMs.push(
      await timeMs(() => {
        const hits = retrieve(row.question);
        extractiveAnswer(row.question, hits);
      }),
    );
    graphMs.push(
      await timeMs(async () => {
        await answerQuestion(row.question);
      }),
    );

    const hits = retrieve(row.question);
    contextChars += hits.reduce((n, h) => n + h.text.length, 0);
    const top = hits[0]?.score ?? 0;
    const genIn = estimateTokens(generatePrompt(row.question, hits));
    llmInput += genIn;
    llmOutput += GEN_OUT_TOKENS;
    if (top < 6 && hits.length > 0) {
      rewriteRows += 1;
      llmInput += estimateTokens(`${REWRITE_SYSTEM}\n${row.question}`);
      llmOutput += REWRITE_OUT_TOKENS;
      const rewritten = `${row.question} workspace`;
      const second = retrieve(rewritten);
      llmInput += estimateTokens(generatePrompt(row.question, second));
      llmOutput += GEN_OUT_TOKENS;
    }
  }

  const extractive = stats(extractiveMs);
  const graph = stats(graphMs);
  const llmUsd = usd(llmInput, llmOutput);
  const round = (n: number, d = 3) => Number(n.toFixed(d));

  const report = {
    capturedAt: new Date().toISOString().slice(0, 10),
    n: rows.length,
    extractive_api_eval: {
      note: "retrieve + extractiveAnswer, the widget's keyless answer, in-process",
      ms_per_row_mean: round(extractive.mean),
      ms_per_row_p50: round(extractive.p50),
      ms_per_row_p95: round(extractive.p95),
      ms_per_row_max: round(extractive.max),
      tokens_per_row: 0,
      usd_per_golden: 0,
    },
    graph_extractive: {
      note: "LangGraph retrieve → generate → END, no API key",
      ms_per_row_mean: round(graph.mean),
      ms_per_row_p50: round(graph.p50),
      ms_per_row_p95: round(graph.p95),
      ms_per_row_max: round(graph.max),
      tokens_per_row: 0,
      usd_per_golden: 0,
    },
    llm_generate_rewrite_estimate: {
      note: "gpt-4o-mini $0.15/$0.60 per 1M tokens, chars/4, no live call",
      rewrite_rows: rewriteRows,
      input_tokens: llmInput,
      output_tokens: llmOutput,
      tokens_per_row: round((llmInput + llmOutput) / rows.length, 1),
      usd_per_golden: round(llmUsd, 6),
      usd_per_row: round(llmUsd / rows.length, 6),
    },
    mean_retrieved_context_chars: Math.round(contextChars / rows.length),
  };

  writeFileSync(join(here, "cost.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
