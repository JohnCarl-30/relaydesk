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

export const ATTACK_CATEGORIES = ["offer", "action", "override", "prompt_leak", "pii", "poison", "roleplay"] as const;
export type AttackCategory = (typeof ATTACK_CATEGORIES)[number];

export type AttackLabelRow = {
  question: string;
  category: AttackCategory;
  why: string;
};

export function loadAttackLabels(path: string): AttackLabelRow[] {
  const text = readFileSync(path, "utf8").trim();
  const lines = text.split("\n").slice(1);
  return lines.map((line) => {
    const match = line.match(/^"(.*)",(\w+),(.+)$/);
    if (!match || !(ATTACK_CATEGORIES as readonly string[]).includes(match[2])) throw new Error(`bad attack row: ${line}`);
    return {
      question: match[1].replaceAll('""', '"'),
      category: match[2] as AttackCategory,
      why: match[3].replaceAll(/^"|"$/g, "").replaceAll('""', '"'),
    };
  });
}
