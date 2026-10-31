/**
 * Runs the widget's answer path over the Langfuse datasets as experiments.
 *
 *   npx --yes tsx eval/run-experiments.ts                    # every experiment
 *   npx --yes tsx eval/run-experiments.ts golden             # one of: golden, escalation, intent
 *   npx --yes tsx eval/run-experiments.ts --run-name baseline
 *
 * Reads LANGFUSE_* and OPENAI_API_KEY from the environment or .env.local.
 * With both Langfuse keys, it runs on the datasets eval/upload-datasets.ts
 * wrote and records a dataset run with every score. Without them, it runs the
 * same task and evaluators on the CSVs and only prints the scores.
 * The answers use the model when OPENAI_API_KEY is set, like the widget. The
 * faithfulness judge needs that key too, and is skipped without it.
 * It exits non-zero when a run score is below its threshold in eval/suite.ts,
 * the same check the PR gate runs through eval/ci/.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LangfuseClient } from "@langfuse/client";
import { flushTracing, initTracing } from "../src/lib/trace";
import { regressions, runLocal } from "./experiments";
import { assertScores, experimentSuite, printScores, type Experiment } from "./suite";

function gitRunName(): string | undefined {
  try {
    const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8" }).trim();
    return `${git("rev-parse", "--abbrev-ref", "HEAD")}@${git("rev-parse", "--short", "HEAD")}`;
  } catch {
    return undefined;
  }
}

/** The same check as the PR gate, so a regression shows up before the push. */
function reportThresholds(experiment: Experiment, evaluations: Parameters<typeof regressions>[0]): boolean {
  const failed = regressions(evaluations, experiment.thresholds);
  for (const line of failed) console.log(`  below threshold: ${line}`);
  return failed.length === 0;
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

  const { experiments, task, metadata } = experimentSuite();
  const unknown = only.filter((key) => !experiments.some((e) => e.key === key));
  if (unknown.length) throw new Error(`unknown experiment: ${unknown.join(", ")}`);
  const selected = only.length ? experiments.filter((e) => only.includes(e.key)) : experiments;

  console.log(`answers: ${metadata.answers}, faithfulness judge: ${metadata.judge}`);

  let passed = true;
  const live = Boolean(process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY);
  if (!live) {
    console.log("LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY not set; scoring the CSVs locally, nothing is recorded.\n");
    for (const experiment of selected) {
      const data = experiment.localItems().map(({ input, expectedOutput, metadata }) => ({
        input,
        expectedOutput,
        metadata: metadata as Record<string, unknown>,
      }));
      const result = await runLocal({ data, ...experiment, task: experiment.task ?? task });
      printScores(`${experiment.dataset} (${result.itemResults.length} items)`, result.runEvaluations);
      assertScores(experiment, result.runEvaluations);
      passed = reportThresholds(experiment, result.runEvaluations) && passed;
    }
    if (!passed) process.exitCode = 1;
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
        task: experiment.task ?? task,
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
      passed = reportThresholds(experiment, result.runEvaluations) && passed;
    }
    if (!passed) process.exitCode = 1;
  } finally {
    await flushTracing();
    await langfuse.shutdown();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
