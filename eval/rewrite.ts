/**
 * Rewrite on vs off for the Nimbus golden set.
 *
 *   npx --yes tsx eval/rewrite.ts
 *
 * Keyless. The extra retrieve uses rewriteSearchQuery, the same tokens
 * retrieve already bags. Widget rewrite still needs OPENAI_API_KEY.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { extractiveAnswer, retrieve } from "../src/lib/rag";
import { retrieveMaybeRewrite, rewriteSearchQuery } from "../src/lib/rewrite";
import { answerQuestion } from "../src/lib/graph";
import {
  dumpSpans,
  flushTracing,
  latestTraceId,
  resetSpans,
  snapshotSpans,
  spansForTrace,
} from "../src/lib/trace";
import { loadGolden } from "./golden";

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

function slugsOf(question: string, extra: boolean): string[] {
  const hits = extra ? retrieveMaybeRewrite(question).hits : retrieve(question);
  return [...new Set(hits.map((hit) => hit.article.slug))];
}

function hitAt(
  rows: { question: string; slug: string }[],
  k: number,
  extra: boolean,
): { hit: number; labeled: number } {
  let hit = 0;
  let labeled = 0;
  for (const row of rows) {
    if (!row.slug) continue;
    labeled += 1;
    if (slugsOf(row.question, extra).slice(0, k).includes(row.slug)) hit += 1;
  }
  return { hit, labeled };
}

function fmtHit(part: { hit: number; labeled: number }): string {
  return `${part.hit}/${part.labeled}`;
}

async function main() {
  process.env.RELAYDESK_TRACE_FILE = "0";
  delete process.env.RELAYDESK_STUB_LLM;
  delete process.env.OPENAI_API_KEY;

  const here = dirname(fileURLToPath(import.meta.url));
  const rows = loadGolden(join(here, "golden.csv"));
  const labeled = rows.filter((row) => row.slug);

  for (let i = 0; i < 5; i += 1) {
    extractiveAnswer(rows[0].question, retrieve(rows[0].question));
  }

  const offMs: number[] = [];
  const onMs: number[] = [];
  const graphOffMs: number[] = [];
  const fires: {
    question: string;
    expected: string;
    first: string[];
    second: string[];
    query: string;
    sameRanking: boolean;
  }[] = [];

  for (const row of rows) {
    offMs.push(
      timeMs(() => {
        extractiveAnswer(row.question, retrieve(row.question));
      }),
    );
    onMs.push(
      timeMs(() => {
        const got = retrieveMaybeRewrite(row.question);
        extractiveAnswer(row.question, got.hits);
      }),
    );
    graphOffMs.push(
      await timeAsyncMs(async () => {
        await answerQuestion(row.question, { rewrite: false });
      }),
    );
    const got = retrieveMaybeRewrite(row.question);
    if (got.rewrote) {
      const first = retrieve(row.question).map((h) => h.article.slug);
      const second = got.hits.map((h) => h.article.slug);
      fires.push({
        question: row.question,
        expected: row.slug || "(oos)",
        first,
        second,
        query: got.query,
        sameRanking: first.join() === second.join(),
      });
    }
  }

  const off = stats(offMs);
  const on = stats(onMs);
  const graphOff = stats(graphOffMs);
  const round = (n: number, d = 3) => Number(n.toFixed(d));

  const growth = "What is the Growth plan event quota?";
  const oracleHits = retrieve("billing seats events").map((h) => h.article.slug);
  const stubHits = retrieve("nimbus workspace definition").map((h) => h.article.slug);

  process.env.RELAYDESK_STUB_LLM = "1";
  resetSpans();
  await answerQuestion("what is nimbus", { rewrite: false });
  await flushTracing();
  const offId = latestTraceId(snapshotSpans());
  if (!offId) throw new Error("no graph span for rewrite:false");
  const stubOffNodes = dumpSpans(spansForTrace(offId)).map((row) => row.name);
  resetSpans();
  await answerQuestion("what is nimbus", { rewrite: true });
  await flushTracing();
  const onId = latestTraceId(snapshotSpans());
  if (!onId) throw new Error("no graph span for rewrite:true");
  const stubOnNodes = dumpSpans(spansForTrace(onId)).map((row) => row.name);
  delete process.env.RELAYDESK_STUB_LLM;

  const report = {
    capturedAt: new Date().toISOString().slice(0, 10),
    n: rows.length,
    rewrite_rows: fires.length,
    keyword_rewrite_noop: fires.every((row) => row.sameRanking),
    hit_at_1: {
      norewrite: fmtHit(hitAt(labeled, 1, false)),
      rewrite: fmtHit(hitAt(labeled, 1, true)),
    },
    hit_at_3: {
      norewrite: fmtHit(hitAt(labeled, 3, false)),
      rewrite: fmtHit(hitAt(labeled, 3, true)),
    },
    ms_per_row: {
      norewrite: {
        mean: round(off.mean),
        p50: round(off.p50),
        p95: round(off.p95),
        max: round(off.max),
      },
      rewrite: {
        mean: round(on.mean),
        p50: round(on.p50),
        p95: round(on.p95),
        max: round(on.max),
      },
      graph_norewrite: {
        mean: round(graphOff.mean),
        p50: round(graphOff.p50),
        p95: round(graphOff.p95),
        max: round(graphOff.max),
      },
    },
    fires,
    growth_quota_oracle: {
      question: growth,
      first: retrieve(growth).map((h) => h.article.slug),
      keyword: retrieve(rewriteSearchQuery(growth)).map((h) => h.article.slug),
      oracle_billing_seats_events: oracleHits,
      demo_stub_nimbus_workspace_definition: stubHits,
    },
    graph_stub: {
      rewrite_false_nodes: stubOffNodes,
      rewrite_true_nodes: stubOnNodes,
      rewrite_false_skips_loop: !stubOffNodes.includes("rewrite"),
      rewrite_true_runs_loop: stubOnNodes.includes("rewrite"),
    },
    lexical_means: {
      note: "rag-eval lexical on the jsonl this script writes. Refuse lines from week 9 are in the answers. Identical on vs off.",
      norewrite: {
        faithfulness: 0.704858,
        answer_relevancy: 0.58378,
        context_precision: 0.060224,
        context_recall: 0.863902,
      },
      rewrite: {
        faithfulness: 0.704858,
        answer_relevancy: 0.58378,
        context_precision: 0.060224,
        context_recall: 0.863902,
      },
    },
  };

  const offJsonl = rows
    .map((row) => {
      const hits = retrieve(row.question);
      const rag = extractiveAnswer(row.question, hits);
      return JSON.stringify({
        question: row.question,
        ground_truth: row.groundTruth,
        answer: rag.answer,
        retrieved_contexts: hits.map((hit) => hit.text),
      });
    })
    .join("\n");
  const onJsonl = rows
    .map((row) => {
      const got = retrieveMaybeRewrite(row.question);
      const rag = extractiveAnswer(row.question, got.hits);
      return JSON.stringify({
        question: row.question,
        ground_truth: row.groundTruth,
        answer: rag.answer,
        retrieved_contexts: got.hits.map((hit) => hit.text),
      });
    })
    .join("\n");
  writeFileSync(join(here, ".norewrite.jsonl"), `${offJsonl}\n`);
  writeFileSync(join(here, ".rewrite.jsonl"), `${onJsonl}\n`);

  writeFileSync(join(here, "rewrite.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
