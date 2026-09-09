import { readFileSync } from "node:fs";

export type GoldenRow = {
  question: string;
  groundTruth: string;
  slug: string;
};

export function loadGolden(path: string): GoldenRow[] {
  const text = readFileSync(path, "utf8").trim();
  const lines = text.split("\n").slice(1);
  return lines.map((line) => {
    const match = line.match(/^"(.*)","(.*)",(.*)$/);
    if (!match) throw new Error(`bad golden row: ${line}`);
    return {
      question: match[1].replaceAll('""', '"'),
      groundTruth: match[2].replaceAll('""', '"'),
      slug: match[3].trim(),
    };
  });
}
