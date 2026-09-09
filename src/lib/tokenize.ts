const STOP = new Set([
  "the",
  "and",
  "for",
  "are",
  "but",
  "not",
  "you",
  "all",
  "can",
  "our",
  "how",
  "what",
  "when",
  "does",
  "with",
  "from",
  "this",
  "that",
  "have",
  "has",
  "was",
  "into",
  "your",
  "about",
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
}
