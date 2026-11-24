/**
 * Runs the faithfulness judge on the labeled answers and prints how often it
 * agrees with the person who labeled them.
 *
 *   RELAYDESK_JUDGE_MODEL=qwen3:8b RELAYDESK_JUDGE_BASE_URL=http://localhost:11434/v1 OPENAI_API_KEY=ollama \
 *     npx --yes tsx eval/run-judge-agreement.ts
 *   RELAYDESK_JUDGE_MODEL=gpt-4.1 npx --yes tsx eval/run-judge-agreement.ts   # OPENAI_API_KEY set
 *
 * Verdicts are cached per judge in judge-runs.json, so a rerun only judges new
 * rows and `npm test` can check agreement keylessly. --fresh rejudges every row.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { faithfulnessJudge, type AnswerOutput } from "./experiments";
import { agreement, loadJson, pairsFor, rowKey, type JudgeRuns, type LabeledAnswer } from "./judge-agreement";
import { judgeModel } from "./suite";

const here = dirname(fileURLToPath(import.meta.url));
const labelsPath = join(here, "faithfulness-labels.json");
const runsPath = join(here, "judge-runs.json");

const labeled = loadJson<LabeledAnswer[]>(labelsPath, []).filter((r) => r.label !== null);
if (labeled.length === 0) throw new Error(`No labeled rows in ${labelsPath}. Run eval/judge-candidates.ts and set each label to 0 or 1.`);
if (!process.env.OPENAI_API_KEY && !process.env.RELAYDESK_JUDGE_API_KEY) {
  throw new Error("Set OPENAI_API_KEY or RELAYDESK_JUDGE_API_KEY (any value for Ollama).");
}

async function main() {
  const { model, name } = judgeModel();
  const judge = faithfulnessJudge(model);
  const runs = loadJson<JudgeRuns>(runsPath, {});
  const verdicts = process.argv.includes("--fresh") ? {} : (runs[name] ?? {});
  runs[name] = verdicts;

  for (const row of labeled) {
    if (verdicts[rowKey(row)]) continue;
    const output: AnswerOutput = { answer: row.answer, citations: row.citations, escalated: false, usedLlm: true, retrieved: [] };
    const result = await judge({ input: { question: row.question }, output } as Parameters<typeof judge>[0]);
    const evaluation = [result].flat()[0];
    if (!evaluation || typeof evaluation.value !== "number") throw new Error(`judge gave no score for: ${row.question}`);
    verdicts[rowKey(row)] = { score: evaluation.value, reason: evaluation.comment ?? "" };
    // Saved per row, so a timeout halfway keeps what was judged.
    writeFileSync(runsPath, `${JSON.stringify(runs, null, 2)}\n`);
    process.stdout.write(".");
  }

  const pairs = pairsFor(labeled, verdicts);
  const a = agreement(pairs);
  console.log(`\njudge ${name} on ${a.n} labeled answers`);
  console.log(`  agreement ${a.agree}/${a.n} (${((a.agree / a.n) * 100).toFixed(1)}%), kappa ${a.kappa === null ? "undefined (one class only)" : a.kappa.toFixed(3)}`);
  console.log(`  judge failed a faithful answer: ${a.judgeMissed}, judge passed an unfaithful one: ${a.judgeLet}`);
  for (const p of pairs.filter((p) => p.human !== p.judge)) {
    console.log(`\n  label ${p.human}, judge ${p.verdict.score}: ${rowKey(p.row)}\n    answer: ${p.row.answer}\n    judge: ${p.verdict.reason}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
