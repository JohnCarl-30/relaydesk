import { readFileSync } from "node:fs";

export type LabelRow = {
  question: string;
  shouldEscalate: boolean;
  why: string;
};

export function loadLabels(path: string): LabelRow[] {
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

export type IntentLabelRow = {
  question: string;
  intent: "lead" | "upgrade" | "churn_risk" | "none";
  why: string;
};

const INTENT_VALUES = new Set(["lead", "upgrade", "churn_risk", "none"]);

export function loadIntentLabels(path: string): IntentLabelRow[] {
  const text = readFileSync(path, "utf8").trim();
  const lines = text.split("\n").slice(1);
  return lines.map((line) => {
    const match = line.match(/^"(.*)",(\w+),(.+)$/);
    if (!match || !INTENT_VALUES.has(match[2])) throw new Error(`bad intent row: ${line}`);
    return {
      question: match[1].replaceAll('""', '"'),
      intent: match[2] as IntentLabelRow["intent"],
      why: match[3].replaceAll(/^"|"$/g, "").replaceAll('""', '"'),
    };
  });
}
