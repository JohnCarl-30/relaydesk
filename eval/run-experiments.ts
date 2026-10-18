/**
 * Runs the widget's answer path over the Langfuse datasets as experiments.
 *
 *   npx --yes tsx eval/run-experiments.ts                    # both experiments
 *   npx --yes tsx eval/run-experiments.ts golden             # one of: golden, escalation
 *   npx --yes tsx eval/run-experiments.ts --run-name baseline
 *
 * Reads LANGFUSE_* and OPENAI_API_KEY from the environment or .env.local.
 * With both Langfuse keys, it runs on the datasets eval/upload-datasets.ts
 * wrote and records a dataset run with every score. Without them, it runs the
 * same task and evaluators on the CSVs and only prints the scores.
 * The answers use the model when OPENAI_API_KEY is set, like the widget. The
 * faithfulness judge needs that key too, and is skipped without it.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LangfuseClient, type Evaluation, type Evaluator, type RunEvaluator } from "@langfuse/client";
import { answerQuestion, chatModel, chatModelName, usingStubLlm } from "../src/lib/graph";
import { flushTracing, initTracing } from "../src/lib/trace";
import { ESCALATION_DATASET, GOLDEN_DATASET, escalationItems, goldenItems, type DesiredItem } from "./datasets";
import {
  answerTask,
  escalationMatch,
  escalationPrecisionRecall,
  faithfulnessJudge,
  hitAtK,
  meanOf,
  runLocal,
} from "./experiments";
import { loadGolden } from "./golden";
import { loadLabels } from "./labels";

type Experiment = {
  key: string;
  dataset: string;
  description: string;
  localItems: () => DesiredItem[];
  evaluators: Evaluator[];
  runEvaluators: RunEvaluator[];
  /** Run scores that must exist. The SDK logs a failing run evaluator and carries on. */
  scores: string[];
};

function gitRunName(): string | undefined {
  try {
    const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8" }).trim();
    return `${git("rev-parse", "--abbrev-ref", "HEAD")}@${git("rev-parse", "--short", "HEAD")}`;
  } catch {
    return undefined;
  }
}

function assertScores(experiment: Experiment, evaluations: Evaluation[]) {
  const missing = experiment.scores.filter((name) => !evaluations.some((e) => e.name === name));
  if (missing.length) throw new Error(`${experiment.dataset}: no run score for ${missing.join(", ")}`);
}

function printScores(title: string, evaluations: Evaluation[]) {
  console.log(title);
  for (const e of evaluations) {
    const value = typeof e.value === "number" ? e.value.toFixed(4) : String(e.value);
    console.log(`  ${e.name.padEnd(22)} ${value}  ${e.comment ?? ""}`);
  }
}

async function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const envFile = join(here, "..", ".env.local");
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  // Experiment traces go to Langfuse, not to eval/traces/live.jsonl.
  process.env.RELAYDESK_TRACE_FILE = "0";

  const args = process.argv.slice(2);
  const runNameAt = args.indexOf("--run-name");
  const runName = runNameAt >= 0 ? args[runNameAt + 1] : gitRunName();
  const only = args.filter((arg, i) => !arg.startsWith("--") && i !== runNameAt + 1);

  const liveModel = Boolean(process.env.OPENAI_API_KEY) && !usingStubLlm();
  const judge = liveModel ? [faithfulnessJudge(chatModel())] : [];

  const experiments: Experiment[] = [
    {
      key: "golden",
      dataset: GOLDEN_DATASET,
      description: "Retrieval hit@k against the expected article, and faithfulness of the answer to its citations.",
      localItems: () => goldenItems(loadGolden(join(here, "golden.csv"))),
      evaluators: [hitAtK, ...judge],
      runEvaluators: [meanOf("hit_at_1", "hit_at_3", "faithfulness")],
      scores: ["hit_at_1", "hit_at_3", ...(liveModel ? ["faithfulness"] : [])],
    },
    {
      key: "escalation",
      dataset: ESCALATION_DATASET,
      description: "Whether the widget opens a ticket exactly when the label says it should.",
      localItems: () => escalationItems(loadLabels(join(here, "escalation-labels.csv"))),
      evaluators: [escalationMatch],
      runEvaluators: [escalationPrecisionRecall, meanOf("escalation_correct")],
      scores: ["escalation_precision", "escalation_recall", "escalation_correct"],
    },
  ];
  const unknown = only.filter((key) => !experiments.some((e) => e.key === key));
  if (unknown.length) throw new Error(`unknown experiment: ${unknown.join(", ")}`);
  const selected = only.length ? experiments.filter((e) => only.includes(e.key)) : experiments;

  const task = answerTask((question) => answerQuestion(question));
  const metadata = { answers: liveModel ? chatModelName() : "extractive", judge: liveModel ? chatModelName() : "none" };
  console.log(`answers: ${metadata.answers}, faithfulness judge: ${metadata.judge}`);

  const live = Boolean(process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY);
  if (!live) {
    console.log("LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY not set; scoring the CSVs locally, nothing is recorded.\n");
    for (const experiment of selected) {
      const data = experiment.localItems().map(({ input, expectedOutput, metadata }) => ({
        input,
        expectedOutput,
        metadata: metadata as Record<string, unknown>,
      }));
      const result = await runLocal({ data, task, ...experiment });
      printScores(`${experiment.dataset} (${result.itemResults.length} items)`, result.runEvaluations);
      assertScores(experiment, result.runEvaluations);
    }
    return;
  }

  // Registers the Langfuse span processor, so each item's trace holds the widget's spans.
  initTracing();
  const langfuse = new LangfuseClient();
  try {
    for (const experiment of selected) {
      const dataset = await langfuse.dataset.get(experiment.dataset);
      const result = await dataset.runExperiment({
        name: experiment.dataset,
        runName,
        description: experiment.description,
        metadata,
        task,
        evaluators: experiment.evaluators,
        runEvaluators: experiment.runEvaluators,
        maxConcurrency: 4,
      });
      if (result.itemResults.length < dataset.items.length) {
        throw new Error(`${experiment.dataset}: ${dataset.items.length - result.itemResults.length} items failed`);
      }
      printScores(`${experiment.dataset} run "${result.runName}" (${result.itemResults.length} items)`, result.runEvaluations);
      if (result.experimentUrl) console.log(`  ${result.experimentUrl}`);
      assertScores(experiment, result.runEvaluations);
    }
  } finally {
    await flushTracing();
    await langfuse.shutdown();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
