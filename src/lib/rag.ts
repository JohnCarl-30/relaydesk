import { ARTICLES, type Article } from "./articles";
import { CHUNKS, chunkArticles, type Chunk } from "./chunks";
import {
  CONFIDENT_MIN_SCORE,
  REFUSE_LINE,
  shouldEscalate,
} from "./escalate";
import { tokenize } from "./tokenize";

export { CHUNKS, chunkArticles, type Chunk };
export { tokenize };

const BM25_K1 = 1.2;
const BM25_B = 0.75;
const RRF_K = 10;

export type Citation = { slug: string; title: string };

export type RagResult = {
  answer: string;
  citations: Citation[];
  confident: boolean;
  usedLlm: boolean;
  escalated: boolean;
};

export type AnswerOptions = {
  alwaysAnswer?: boolean;
};

export type RetrieveMode = "count" | "bm25" | "hybrid";
export type RetrieveUnit = "article" | "chunk";

export type RetrieveOptions = {
  k?: number;
  titleWeight?: number;
  mode?: RetrieveMode;
  unit?: RetrieveUnit;
};

export type Hit = {
  article: Article;
  score: number;
  text: string;
  chunkId?: string;
};

type FieldStats = {
  tf: Map<string, number>;
  len: number;
};

type IndexedDoc = {
  article: Article;
  title: FieldStats;
  body: FieldStats;
};

function fieldStats(tokens: string[]): FieldStats {
  const tf = new Map<string, number>();
  for (const token of tokens) {
    tf.set(token, (tf.get(token) ?? 0) + 1);
  }
  return { tf, len: tokens.length };
}

function buildIndex(articles: Article[]) {
  const docs: IndexedDoc[] = articles.map((article) => ({
    article,
    title: fieldStats(tokenize(article.title)),
    body: fieldStats(tokenize(article.body)),
  }));
  const df = new Map<string, number>();
  let titleLenSum = 0;
  let bodyLenSum = 0;
  for (const doc of docs) {
    titleLenSum += doc.title.len;
    bodyLenSum += doc.body.len;
    const seen = new Set([...doc.title.tf.keys(), ...doc.body.tf.keys()]);
    for (const term of seen) {
      df.set(term, (df.get(term) ?? 0) + 1);
    }
  }
  const n = docs.length;
  return {
    docs,
    n,
    df,
    avgTitleLen: titleLenSum / Math.max(n, 1),
    avgBodyLen: bodyLenSum / Math.max(n, 1),
  };
}

const INDEX = buildIndex(ARTICLES);

function articleText(article: Article): string {
  return `${article.title}\n\n${article.body}`;
}

function bm25Tf(tf: number, dl: number, avgdl: number): number {
  if (tf <= 0 || avgdl <= 0) return 0;
  return (tf * (BM25_K1 + 1)) / (tf + BM25_K1 * (1 - BM25_B + BM25_B * (dl / avgdl)));
}

function idf(df: number, n: number): number {
  return Math.log(1 + (n - df + 0.5) / (df + 0.5));
}

function scoreCount(
  questionTokens: string[],
  title: string,
  body: string,
  titleWeight: number,
): number {
  const titleToks = tokenize(title);
  const bodyToks = tokenize(body);
  let score = 0;
  for (const term of questionTokens) {
    if (titleToks.includes(term)) score += titleWeight;
    score += bodyToks.filter((t) => t === term).length;
  }
  return score;
}

function retrieveCountArticles(
  questionTokens: string[],
  k: number,
  titleWeight: number,
): Hit[] {
  const scored = ARTICLES.map((article) => ({
    article,
    score: scoreCount(questionTokens, article.title, article.body, titleWeight),
    text: articleText(article),
  }));
  return scored
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

function retrieveCountChunks(
  questionTokens: string[],
  k: number,
  titleWeight: number,
): Hit[] {
  const scored = CHUNKS.map((chunk) => ({
    article: chunk.article,
    score: scoreCount(questionTokens, chunk.article.title, chunk.text, titleWeight),
    text: `${chunk.article.title}\n\n${chunk.text}`,
    chunkId: chunk.id,
  }));
  return scored
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

function retrieveBm25(
  questionTokens: string[],
  k: number,
  titleWeight: number,
): Hit[] {
  const scored = INDEX.docs.map((doc) => {
    let score = 0;
    for (const term of questionTokens) {
      const df = INDEX.df.get(term) ?? 0;
      if (df === 0) continue;
      const weight = idf(df, INDEX.n);
      const titleTf = doc.title.tf.get(term) ?? 0;
      const bodyTf = doc.body.tf.get(term) ?? 0;
      score +=
        weight *
        (titleWeight * bm25Tf(titleTf, doc.title.len, INDEX.avgTitleLen) +
          bm25Tf(bodyTf, doc.body.len, INDEX.avgBodyLen));
    }
    return { article: doc.article, score, text: articleText(doc.article) };
  });
  return scored
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

export function retrieve(question: string, options: RetrieveOptions = {}): Hit[] {
  const k = options.k ?? 3;
  const titleWeight = options.titleWeight ?? 4;
  const mode = options.mode ?? "count";
  const unit = options.unit ?? "article";
  const q = tokenize(question);
  if (q.length === 0) return [];
  if (mode === "hybrid") {
    throw new Error("hybrid retrieval is async; call retrieveHybrid()");
  }
  if (mode === "bm25") {
    if (unit === "chunk") {
      throw new Error("bm25 is article-level only; use count or hybrid for chunks");
    }
    return retrieveBm25(q, k, titleWeight);
  }
  if (unit === "chunk") {
    return retrieveCountChunks(q, k, titleWeight);
  }
  return retrieveCountArticles(q, k, titleWeight);
}

function rrfScore(rank: number): number {
  return 1 / (RRF_K + rank + 1);
}

function hitKey(row: Hit): string {
  return row.chunkId ?? row.article.slug;
}

export function fuseRrf(lexical: Hit[], dense: Hit[], k: number): Hit[] {
  const scores = new Map<string, Hit>();
  const addList = (list: Hit[]) => {
    list.forEach((row, rank) => {
      const key = hitKey(row);
      const current = scores.get(key);
      scores.set(key, {
        ...row,
        score: (current?.score ?? 0) + rrfScore(rank),
      });
    });
  };
  addList(lexical);
  addList(dense);
  return [...scores.values()].sort((a, b) => b.score - a.score).slice(0, k);
}

export function retrieveDenseFromVecs(
  queryVec: number[],
  rows: { article: Article; vec: number[]; text: string; chunkId?: string }[],
): Hit[] {
  return rows
    .map((row) => ({
      article: row.article,
      score: dot(queryVec, row.vec),
      text: row.text,
      chunkId: row.chunkId,
    }))
    .sort((a, b) => b.score - a.score);
}

function dot(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < n; i += 1) sum += a[i] * b[i];
  return sum;
}

export async function retrieveHybrid(
  question: string,
  options: RetrieveOptions = {},
): Promise<Hit[]> {
  const k = options.k ?? 3;
  const titleWeight = options.titleWeight ?? 4;
  const unit = options.unit ?? "article";
  const q = tokenize(question);
  if (q.length === 0) return [];
  const embed = await import("./embed");
  const [queryVec, denseRows] = await Promise.all([
    embed.embedQuery(question),
    unit === "chunk" ? embed.chunkEmbeddings() : embed.articleEmbeddings(),
  ]);
  const lexical =
    unit === "chunk"
      ? retrieveCountChunks(q, CHUNKS.length, titleWeight)
      : retrieveCountArticles(q, ARTICLES.length, titleWeight);
  const dense = retrieveDenseFromVecs(queryVec, denseRows);
  return fuseRrf(lexical, dense, k);
}

function citationsFromHits(hits: Hit[]): Citation[] {
  const seen = new Set<string>();
  const citations: Citation[] = [];
  for (const hit of hits) {
    if (seen.has(hit.article.slug)) continue;
    seen.add(hit.article.slug);
    citations.push({ slug: hit.article.slug, title: hit.article.title });
  }
  return citations;
}

export function extractiveAnswer(
  question: string,
  hits: Hit[],
  options: AnswerOptions = {},
): RagResult {
  const escalated = !options.alwaysAnswer && shouldEscalate(question, hits);
  if (escalated) {
    return {
      answer: REFUSE_LINE,
      citations: [],
      confident: false,
      usedLlm: false,
      escalated: true,
    };
  }
  if (hits.length === 0) {
    return {
      answer: REFUSE_LINE,
      citations: [],
      confident: false,
      usedLlm: false,
      escalated: false,
    };
  }
  const top = hits[0];
  const source = top.chunkId
    ? top.text.replace(`${top.article.title}\n\n`, "")
    : top.article.body;
  const sentences = source
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
    citations: citationsFromHits(hits),
    confident: top.score >= CONFIDENT_MIN_SCORE,
    usedLlm: false,
    escalated: false,
  };
}
