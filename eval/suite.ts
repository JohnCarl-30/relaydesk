/**
 * The experiments run-experiments.ts runs from a terminal and eval/ci/*.ts run
 * in the PR gate, with the threshold each run score must stay at or above.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  RegressionError,
  type Evaluation,
  type Evaluator,
  type ExperimentResult,
  type ExperimentTask,
  type RunEvaluator,
  type RunnerContext,
} from "@langfuse/client";
import { answerQuestion, chatModel, chatModelName, usingStubLlm } from "../src/lib/graph";
import { ESCALATION_DATASET, GOLDEN_DATASET, escalationItems, goldenItems, type DesiredItem } from "./datasets";
import {
  answerTask,
  escalationMatch,
  escalationPrecisionRecall,
  faithfulnessJudge,
  hitAtK,
  meanOf,
  regressions,
  type Threshold,
} from "./experiments";
import { loadGolden } from "./golden";
import { loadLabels } from "./labels";

export type Experiment = {
  key: string;
  dataset: string;
  description: string;
  localItems: () => DesiredItem[];
  evaluators: Evaluator[];
  runEvaluators: RunEvaluator[];
  /** Run scores that must exist. The SDK logs a failing run evaluator and carries on. */
  scores: string[];
  /**
   * The gate. Retrieval and escalation are deterministic, so these sit at the
   * scores main had on 2026-10-22 and one more miss fails. Raise them when a
   * change moves a score up.
   */
  thresholds: Threshold[];
};

export type Suite = {
  experiments: Experiment[];
  task: ExperimentTask;
  metadata: { answers: string; judge: string };
};

const here = dirname(fileURLToPath(import.meta.url));

export function experimentSuite(): Suite {
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
      thresholds: [
        { name: "hit_at_1", min: 0.83 }, // 50/60
        { name: "hit_at_3", min: 0.91 }, // 55/60
        // No live baseline yet; checked whenever OPENAI_API_KEY is set.
        { name: "faithfulness", min: 0.8, optional: true },
      ],
    },
    {
      key: "escalation",
      dataset: ESCALATION_DATASET,
      description: "Whether the widget opens a ticket exactly when the label says it should.",
      localItems: () => escalationItems(loadLabels(join(here, "escalation-labels.csv"))),
      evaluators: [escalationMatch],
      runEvaluators: [escalationPrecisionRecall, meanOf("escalation_correct")],
      scores: ["escalation_precision", "escalation_recall", "escalation_correct"],
      thresholds: [
        { name: "escalation_precision", min: 1 }, // 7/7
        { name: "escalation_recall", min: 0.63 }, // 7/11
      ],
    },
  ];
  return {
    experiments,
    task: answerTask((question) => answerQuestion(question)),
    metadata: { answers: liveModel ? chatModelName() : "extractive", judge: liveModel ? chatModelName() : "none" },
  };
}

export function assertScores(experiment: Experiment, evaluations: Evaluation[]) {
  const missing = experiment.scores.filter((name) => !evaluations.some((e) => e.name === name));
  if (missing.length) throw new Error(`${experiment.dataset}: no run score for ${missing.join(", ")}`);
}

export function printScores(title: string, evaluations: Evaluation[]) {
  console.log(title);
  for (const e of evaluations) {
    const value = typeof e.value === "number" ? e.value.toFixed(4) : String(e.value);
    console.log(`  ${e.name.padEnd(22)} ${value}  ${e.comment ?? ""}`);
  }
}

/**
 * Runs one experiment for langfuse/experiment-action, on the dataset the action
 * loaded into `context`. Throws RegressionError when a run score is below its
 * threshold, which fails the check and marks the PR comment as a regression.
 */
export async function runGated(context: RunnerContext, key: string): Promise<ExperimentResult> {
  // Experiment traces go to Langfuse, not to eval/traces/live.jsonl.
  process.env.RELAYDESK_TRACE_FILE = "0";
  const { experiments, task, metadata } = experimentSuite();
  const experiment = experiments.find((e) => e.key === key);
  if (!experiment) throw new Error(`unknown experiment: ${key}`);
  if (!context.data?.length) throw new Error(`${experiment.dataset}: set dataset_name on the action step`);
  console.log(`answers: ${metadata.answers}, faithfulness judge: ${metadata.judge}`);

  const result = await context.runExperiment({
    name: experiment.dataset,
    description: experiment.description,
    metadata,
    task,
    evaluators: experiment.evaluators,
    runEvaluators: experiment.runEvaluators,
    maxConcurrency: 4,
  });
  printScores(`${experiment.dataset} (${result.itemResults.length} items)`, result.runEvaluations);
  if (result.itemResults.length < context.data.length) {
    throw new Error(`${experiment.dataset}: ${context.data.length - result.itemResults.length} items failed`);
  }
  assertScores(experiment, result.runEvaluations);
  const failed = regressions(result.runEvaluations, experiment.thresholds);
  if (failed.length) throw new RegressionError({ result, message: `${experiment.dataset}: ${failed.join("; ")}` });
  return result;
}
