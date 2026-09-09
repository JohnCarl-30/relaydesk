import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { extractiveAnswer, retrieve } from "../src/lib/rag";

type LabelRow = {
  question: string;
  shouldEscalate: boolean;
  why: string;
};

type Confusion = {
  precision: number;
  recall: number;
  f1: number;
  tp: number;
  fp: number;
  fn: number;
  tn: number;
};

function loadLabels(path: string): LabelRow[] {
  const text = readFileSync(path, "utf8").trim();
  const lines = text.split("\n").slice(1);
  return lines.map((line) => {
    const match = line.match(/^"(.*)",(\d),(.+)$/);
    if (!match) throw new Error(`bad label row: ${line}`);
    return {
      question: match[1].replaceAll('""', '"'),
      shouldEscalate: match[2] === "1",
      why: match[3].replaceAll(/^"|"$/g, "").replaceAll('""', '"'),
    };
  });
}

function confusion(pred: boolean[], gold: boolean[]): Confusion {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  for (let i = 0; i < gold.length; i += 1) {
    if (pred[i] && gold[i]) tp += 1;
    else if (pred[i] && !gold[i]) fp += 1;
    else if (!pred[i] && gold[i]) fn += 1;
    else tn += 1;
  }
  const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { precision, recall, f1, tp, fp, fn, tn };
}

function fmt(n: number): string {
  return n.toFixed(4);
}

function printBlock(name: string, m: Confusion) {
  console.log(
    name.padEnd(14),
    "p",
    fmt(m.precision),
    "r",
    fmt(m.recall),
    "f1",
    fmt(m.f1),
    `tp=${m.tp}`,
    `fp=${m.fp}`,
    `fn=${m.fn}`,
    `tn=${m.tn}`,
  );
}

function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const rows = loadLabels(join(here, "escalation-labels.csv"));
  if (rows.length !== 15) {
    throw new Error(`n === ${rows.length}, expected 15`);
  }

  const gold = rows.map((row) => row.shouldEscalate);
  const policyPred: boolean[] = [];
  const alwaysPred: boolean[] = [];

  console.log(
    "gold".padEnd(5),
    "pol".padEnd(4),
    "aa".padEnd(3),
    "question",
  );
  for (const row of rows) {
    const hits = retrieve(row.question);
    const policy = extractiveAnswer(row.question, hits);
    const always = extractiveAnswer(row.question, hits, { alwaysAnswer: true });
    policyPred.push(policy.escalated);
    alwaysPred.push(always.escalated);
    console.log(
      (row.shouldEscalate ? "1" : "0").padEnd(5),
      (policy.escalated ? "1" : "0").padEnd(4),
      (always.escalated ? "1" : "0").padEnd(3),
      row.question,
    );
  }

  const policy = confusion(policyPred, gold);
  const alwaysAnswer = confusion(alwaysPred, gold);
  console.log("");
  printBlock("policy", policy);
  printBlock("alwaysAnswer", alwaysAnswer);
  console.log("n", rows.length);

  writeFileSync(
    join(here, "escalation.json"),
    `${JSON.stringify({ policy, alwaysAnswer, n: 15 }, null, 2)}\n`,
  );
}

main();
