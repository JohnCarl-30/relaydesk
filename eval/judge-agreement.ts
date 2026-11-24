/**
 * How often the faithfulness judge agrees with a person. The labels are in
 * faithfulness-labels.json (eval/judge-candidates.ts writes them, a person
 * fills `label`), and each judge's verdicts are cached in judge-runs.json by
 * eval/run-judge-agreement.ts so `npm test` can check them without a model.
 */
import { readFileSync } from "node:fs";
import type { AnswerPath } from "../src/lib/graph";

export type LabeledAnswer = {
  question: string;
  answer: string;
  citations: string[];
  /** The model that wrote the answer. */
  model: string;
  /** The answer path that wrote it: the LangGraph graph or the agent loop (#70). */
  path: AnswerPath;
  /** 1 when every claim is in the cited articles, 0 when one isn't. null until a person labels it. */
  label: 0 | 1 | null;
  note: string;
};

export type JudgeVerdict = { score: number; reason: string };

/** A question can be answered on both paths, so a row is the pair. */
export function rowKey(row: Pick<LabeledAnswer, "path" | "question">): string {
  return `${row.path}: ${row.question}`;
}

/** Judge model name -> rowKey -> verdict. */
export type JudgeRuns = Record<string, Record<string, JudgeVerdict>>;

/** The judge scores 0..1; at or above this it counts as "faithful". */
export const JUDGE_PASS = 0.5;

/**
 * Judges whose agreement `npm test` gates. Only a judge listed here may grade
 * the `faithfulness` score in eval/suite.ts with its threshold taken at face value.
 */
export const CALIBRATED_JUDGES: string[] = [];

/** Cohen's kappa at or above this is "substantial" agreement (Landis & Koch). */
export const MIN_KAPPA = 0.6;

export type Agreement = {
  n: number;
  agree: number;
  /** null when both raters gave one class only, where kappa is undefined. */
  kappa: number | null;
  /** Rows the person called faithful and the judge didn't, and the reverse. */
  judgeMissed: number;
  judgeLet: number;
};

export function agreement(pairs: { human: 0 | 1; judge: 0 | 1 }[]): Agreement {
  const n = pairs.length;
  if (n === 0) return { n, agree: 0, kappa: null, judgeMissed: 0, judgeLet: 0 };
  const agree = pairs.filter((p) => p.human === p.judge).length;
  const human1 = pairs.filter((p) => p.human === 1).length / n;
  const judge1 = pairs.filter((p) => p.judge === 1).length / n;
  const observed = agree / n;
  const chance = human1 * judge1 + (1 - human1) * (1 - judge1);
  return {
    n,
    agree,
    kappa: chance === 1 ? null : (observed - chance) / (1 - chance),
    judgeMissed: pairs.filter((p) => p.human === 1 && p.judge === 0).length,
    judgeLet: pairs.filter((p) => p.human === 0 && p.judge === 1).length,
  };
}

/** Labeled rows that the judge has a verdict for, as 0/1 pairs. */
export function pairsFor(labels: LabeledAnswer[], verdicts: Record<string, JudgeVerdict>) {
  return labels.flatMap((row) => {
    const verdict = verdicts[rowKey(row)];
    if (row.label === null || !verdict) return [];
    return [{ row, verdict, human: row.label, judge: (verdict.score >= JUDGE_PASS ? 1 : 0) as 0 | 1 }];
  });
}

export function loadJson<T>(path: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw error;
  }
}
