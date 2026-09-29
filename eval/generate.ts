/**
 * Extractive vs LLM generate for the Nimbus golden set.
 *
 *   npx --yes tsx eval/generate.ts
 *
 * Timed extractive arm is keyless. Generate calls the model only when
 * OPENAI_API_KEY is already in the environment. Otherwise it falls back
 * and $ is estimated.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { shouldEscalate } from "../src/lib/escalate";
import { generateFromHits } from "../src/lib/graph";
import { forceExtractiveAnswers } from "../src/lib/keyless";
import { extractiveAnswer, retrieve } from "../src/lib/rag";
import { loadGolden } from "./golden";

const GENERATE_SYSTEM =
  "You are the Nimbus support assistant on a customer site. Answer only from the provided help articles. Be short. If the articles do not contain the answer, say you are unsure and suggest talking to a human. Mention article titles naturally. Do not invent policies, prices, or product behavior.";

const INPUT_PER_M = 0.15;
const OUTPUT_PER_M = 0.6;
const GEN_OUT_TOKENS = 120;

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

function timeMs(fn: () => void): number {
  const start = performance.now();
  fn();
  return performance.now() - start;
}

async function timeAsyncMs(fn: () => Promise<void>): Promise<number> {
  const start = performance.now();
  await fn();
  return performance.now() - start;
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

function slugsOf(question: string): string[] {
  return [...new Set(retrieve(question).map((hit) => hit.article.slug))];
}

function hitAt(rows: { question: string; slug: string }[], k: number): { hit: number; labeled: number } {
  let hit = 0;
  let labeled = 0;
  for (const row of rows) {
    if (!row.slug) continue;
    labeled += 1;
    if (slugsOf(row.question).slice(0, k).includes(row.slug)) hit += 1;
  }
  return { hit, labeled };
}

function fmtHit(part: { hit: number; labeled: number }): string {
  return `${part.hit}/${part.labeled}`;
}

async function main() {
  const liveKey = forceExtractiveAnswers();

  const here = dirname(fileURLToPath(import.meta.url));
  const rows = loadGolden(join(here, "golden.csv"));
  const labeled = rows.filter((row) => row.slug);

  for (let i = 0; i < 5; i += 1) {
    extractiveAnswer(rows[0].question, retrieve(rows[0].question));
  }

  const extractiveMs: number[] = [];
  let wouldCall = 0;
  let llmInput = 0;
  let llmOutput = 0;

  for (const row of rows) {
    extractiveMs.push(
      timeMs(() => {
        extractiveAnswer(row.question, retrieve(row.question));
      }),
    );
    const hits = retrieve(row.question);
    if (!shouldEscalate(row.question, hits)) {
      wouldCall += 1;
      llmInput += estimateTokens(generatePrompt(row.question, hits));
      llmOutput += GEN_OUT_TOKENS;
    }
  }

  if (liveKey) process.env.OPENAI_API_KEY = liveKey;

  const generateMs: number[] = [];
  let actuallyCalled = 0;
  for (const row of rows) {
    let rag: Awaited<ReturnType<typeof generateFromHits>> | undefined;
    generateMs.push(
      await timeAsyncMs(async () => {
        rag = await generateFromHits(row.question, retrieve(row.question));
      }),
    );
    if (!rag) throw new Error("generateFromHits returned nothing");
    if (rag.usedLlm) actuallyCalled += 1;
  }

  const extractive = stats(extractiveMs);
  const generate = stats(generateMs);
  const llmUsd = usd(llmInput, llmOutput);
  const round = (n: number, d = 3) => Number(n.toFixed(d));

  const hit1 = fmtHit(hitAt(labeled, 1));
  const hit3 = fmtHit(hitAt(labeled, 3));

  const report = {
    capturedAt: new Date().toISOString().slice(0, 10),
    n: rows.length,
    live_key_present: Boolean(liveKey),
    would_call_model: wouldCall,
    actually_called_model: actuallyCalled,
    hit_at_1: {
      extractive: hit1,
      generate: hit1,
    },
    hit_at_3: {
      extractive: hit3,
      generate: hit3,
    },
    hit_at_k_identical: true,
    ms_per_row: {
      extractive: {
        mean: round(extractive.mean),
        p50: round(extractive.p50),
        p95: round(extractive.p95),
        max: round(extractive.max),
      },
      generate: {
        mean: round(generate.mean),
        p50: round(generate.p50),
        p95: round(generate.p95),
        max: round(generate.max),
      },
    },
    generate_only_estimate: {
      note: "gpt-4o-mini $0.15/$0.60 per 1M tokens, chars/4, ~120 output tokens. Rows that would call the model only. No rewrite loop.",
      would_call_model: wouldCall,
      input_tokens: llmInput,
      output_tokens: llmOutput,
      tokens_per_row: round((llmInput + llmOutput) / rows.length, 1),
      usd_per_golden: round(llmUsd, 6),
      usd_per_row: round(llmUsd / rows.length, 6),
    },
  };

  writeFileSync(join(here, "generate.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
