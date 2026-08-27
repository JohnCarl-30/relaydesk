import { ARTICLES, type Article } from "./articles";

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

export type Citation = { slug: string; title: string };

export type RagResult = {
  answer: string;
  citations: Citation[];
  confident: boolean;
  usedLlm: boolean;
};

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
}

export type RetrieveOptions = {
  k?: number;
  titleWeight?: number;
};

export function retrieve(
  question: string,
  options: RetrieveOptions = {},
): { article: Article; score: number }[] {
  const k = options.k ?? 3;
  const titleWeight = options.titleWeight ?? 4;
  const q = tokenize(question);
  if (q.length === 0) return [];
  const scored = ARTICLES.map((article) => {
    const titleToks = tokenize(article.title);
    const bodyToks = tokenize(article.body);
    let score = 0;
    for (const term of q) {
      if (titleToks.includes(term)) score += titleWeight;
      score += bodyToks.filter((t) => t === term).length;
    }
    return { article, score };
  });
  return scored
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

export function extractiveAnswer(
  question: string,
  hits: { article: Article; score: number }[],
): RagResult {
  if (hits.length === 0) {
    return {
      answer:
        "I don't have that in the Nimbus help center. Leave your email and a teammate will pick this up.",
      citations: [],
      confident: false,
      usedLlm: false,
    };
  }
  const top = hits[0];
  const sentences = top.article.body
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const q = new Set(tokenize(question));
  const ranked = [...sentences].sort((a, b) => {
    const sa = tokenize(a).filter((t) => q.has(t)).length;
    const sb = tokenize(b).filter((t) => q.has(t)).length;
    return sb - sa;
  });
  const picked = ranked.slice(0, 2).join(" ");
  return {
    answer: `${picked}\n\nThat's from "${top.article.title}". If this isn't the case you're in, talk to a person.`,
    citations: hits.map((h) => ({ slug: h.article.slug, title: h.article.title })),
    confident: top.score >= 6,
    usedLlm: false,
  };
}
