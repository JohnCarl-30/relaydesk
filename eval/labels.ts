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
