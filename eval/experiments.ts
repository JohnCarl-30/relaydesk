import type {
  Evaluation,
  Evaluator,
  ExperimentItem,
  ExperimentItemResult,
  ExperimentTask,
  RunEvaluator,
} from "@langfuse/client";
import { getArticle } from "../src/lib/articles";
import type { ChatLike } from "../src/lib/graph";
import { retrieve } from "../src/lib/rag";

/** What the widget did with one question. */
export type AnswerOutput = {
  answer: string;
  /** Slugs the answer cites. */
  citations: string[];
  escalated: boolean;
  usedLlm: boolean;
  /** Top-3 unique article slugs from the widget's first retrieval, best first. */
  retrieved: string[];
};

type Answer = (question: string) => Promise<{
  answer: string;
  citations: { slug: string }[];
  escalated: boolean;
  usedLlm: boolean;
}>;

/** Both datasets store `{ question }` as input. */
export function answerTask(answer: Answer): ExperimentTask {
  return async (item): Promise<AnswerOutput> => {
    const { question } = item.input as { question: string };
    const result = await answer(question);
    return {
      answer: result.answer,
      citations: result.citations.map((c) => c.slug),
      escalated: result.escalated,
      usedLlm: result.usedLlm,
      retrieved: [...new Set(retrieve(question).map((hit) => hit.article.slug))],
    };
  };
}

/** hit@1 and hit@3 against `expectedOutput.slug`. Out-of-corpus rows (slug null) get no score. */
export const hitAtK: Evaluator = async ({ output, expectedOutput }) => {
  const slug = (expectedOutput as { slug: string | null } | undefined)?.slug;
  if (!slug) return [];
  const { retrieved } = output as AnswerOutput;
  return [1, 3].map((k) => ({
    name: `hit_at_${k}`,
    value: retrieved.slice(0, k).includes(slug) ? 1 : 0,
    comment: `expected ${slug}, got ${retrieved.join(", ") || "nothing"}`,
  }));
};

/** 1 when the widget escalated exactly when the label says it should. */
export const escalationMatch: Evaluator = async ({ output, expectedOutput }) => {
  const expected = (expectedOutput as { shouldEscalate: boolean }).shouldEscalate;
  const { escalated } = output as AnswerOutput;
  return {
    name: "escalation_correct",
    value: escalated === expected ? 1 : 0,
    comment: `expected ${expected ? "escalate" : "answer"}, got ${escalated ? "escalate" : "answer"}`,
  };
};

const JUDGE_SYSTEM = `You grade a support answer for faithfulness to the help articles it cites.
Faithful means every claim in the answer is stated in or directly implied by the articles. Wording can differ.
Reply with JSON only: {"score": <number from 0 to 1>, "reason": "<one sentence naming any unsupported claim>"}.
1 means fully supported, 0 means the main claim is unsupported.`;

/** Pulls `{"score": n, "reason": "..."}` out of a model reply, tolerating code fences and extra text. */
export function parseJudgeReply(text: string): { score: number; reason: string } {
  const json = text.match(/\{[\s\S]*\}/)?.[0];
  if (!json) throw new Error(`judge reply has no JSON: ${text}`);
  const parsed = JSON.parse(json) as { score?: unknown; reason?: unknown };
  const score = Number(parsed.score);
  if (!Number.isFinite(score) || score < 0 || score > 1) {
    throw new Error(`judge score out of range: ${text}`);
  }
  return { score, reason: typeof parsed.reason === "string" ? parsed.reason : "" };
}

/**
 * LLM judge: is the answer supported by the articles it cites? Escalations and
 * answers without citations have nothing to check against, so they get no score.
 */
export function faithfulnessJudge(model: ChatLike): Evaluator {
  return async ({ input, output }) => {
    const { answer, citations, escalated } = output as AnswerOutput;
    const articles = citations.flatMap((slug) => {
      const article = getArticle(slug);
      return article ? [article] : [];
    });
    if (escalated || articles.length === 0) return [];
    const context = articles.map((a, i) => `[${i + 1}] ${a.title}\n${a.body}`).join("\n\n");
    const { question } = input as { question: string };
    const response = await model.invoke([
      { role: "system", content: JUDGE_SYSTEM },
      {
        role: "user",
        content: `Articles:\n${context}\n\nQuestion: ${question}\n\nAnswer: ${answer}`,
      },
    ]);
    const text = typeof response.content === "string" ? response.content : JSON.stringify(response.content);
    const { score, reason } = parseJudgeReply(text);
    return { name: "faithfulness", value: score, comment: reason };
  };
}

function scores(results: ExperimentItemResult[], name: string): number[] {
  return results.flatMap((r) =>
    r.evaluations.filter((e) => e.name === name && typeof e.value === "number").map((e) => e.value as number),
  );
}

/** Run score = mean of the item scores with the same name. Names with no item scores are left out. */
export function meanOf(...names: string[]): RunEvaluator {
  return async ({ itemResults }) =>
    names.flatMap((name) => {
      const values = scores(itemResults, name);
      if (values.length === 0) return [];
      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      return [{ name, value: mean, comment: `mean of ${values.length} items` }];
    });
}

/** Precision and recall of "escalate", the way eval/escalation.ts scores them. */
export const escalationPrecisionRecall: RunEvaluator = async ({ itemResults }) => {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  for (const r of itemResults) {
    // The SDK's item results carry the expected output only on `item`.
    const expected = (r.item.expectedOutput as { shouldEscalate: boolean }).shouldEscalate;
    const { escalated } = r.output as AnswerOutput;
    if (escalated && expected) tp += 1;
    else if (escalated) fp += 1;
    else if (expected) fn += 1;
  }
  const counts = `tp=${tp} fp=${fp} fn=${fn}`;
  return [
    { name: "escalation_precision", value: tp + fp === 0 ? 0 : tp / (tp + fp), comment: counts },
    { name: "escalation_recall", value: tp + fn === 0 ? 0 : tp / (tp + fn), comment: counts },
  ];
};

export type LocalResult = {
  itemResults: ExperimentItemResult[];
  runEvaluations: Evaluation[];
};

/**
 * Runs a task and its evaluators over local items in order, without Langfuse.
 * Same inputs and outputs as `langfuse.experiment.run`, for keyless runs and tests.
 * Unlike the SDK, a failing task or evaluator throws instead of being logged and skipped.
 */
export async function runLocal(params: {
  data: ExperimentItem[];
  task: ExperimentTask;
  evaluators?: Evaluator[];
  runEvaluators?: RunEvaluator[];
}): Promise<LocalResult> {
  const itemResults: ExperimentItemResult[] = [];
  for (const item of params.data) {
    const output = await params.task(item);
    const evaluations: Evaluation[] = [];
    for (const evaluator of params.evaluators ?? []) {
      const result = await evaluator({
        input: item.input,
        output,
        expectedOutput: item.expectedOutput,
        metadata: item.metadata ?? undefined,
      });
      evaluations.push(...(Array.isArray(result) ? result : [result]));
    }
    // Same shape as the SDK's results, which leave input and expectedOutput on `item`.
    itemResults.push({ item, output, evaluations });
  }
  const runEvaluations: Evaluation[] = [];
  for (const runEvaluator of params.runEvaluators ?? []) {
    const result = await runEvaluator({ itemResults });
    runEvaluations.push(...(Array.isArray(result) ? result : [result]));
  }
  return { itemResults, runEvaluations };
}
