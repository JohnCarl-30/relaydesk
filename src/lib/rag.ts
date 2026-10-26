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
  /** The business's "not in the help center" line. Defaults to Nimbus's. */
  refuseLine?: string;
  /** Words to ignore when checking coverage, e.g. the business's own name. */
  ignoreTerms?: string[];
  /** Text whose words pick the quoted sentences first, e.g. the follow-up inside a contextualized question. */
  focus?: string;
};

export type RetrieveMode = "count" | "bm25" | "hybrid";
export type RetrieveUnit = "article" | "chunk";

export type RetrieveOptions = {
  /** The articles to search. Defaults to the Nimbus demo help center. */
  corpus?: Corpus;
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

type Index = ReturnType<typeof buildIndex>;

/** One business's searchable articles: the articles, their chunks, and the BM25 index. */
export type Corpus = {
  articles: Article[];
  chunks: Chunk[];
  index: Index;
};

export function buildCorpus(articles: Article[]): Corpus {
  return { articles, chunks: chunkArticles(articles), index: buildIndex(articles) };
}

/** The Nimbus demo help center. Evals and tests run against it. */
export const DEMO_CORPUS: Corpus = {
  articles: ARTICLES,
  chunks: CHUNKS,
  index: buildIndex(ARTICLES),
};

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
  corpus: Corpus,
  questionTokens: string[],
  k: number,
  titleWeight: number,
): Hit[] {
  const scored = corpus.articles.map((article) => ({
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
  corpus: Corpus,
  questionTokens: string[],
  k: number,
  titleWeight: number,
): Hit[] {
  const scored = corpus.chunks.map((chunk) => ({
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
  corpus: Corpus,
  questionTokens: string[],
  k: number,
  titleWeight: number,
): Hit[] {
  const { index } = corpus;
  const scored = index.docs.map((doc) => {
    let score = 0;
    for (const term of questionTokens) {
      const df = index.df.get(term) ?? 0;
      if (df === 0) continue;
      const weight = idf(df, index.n);
      const titleTf = doc.title.tf.get(term) ?? 0;
      const bodyTf = doc.body.tf.get(term) ?? 0;
      score +=
        weight *
        (titleWeight * bm25Tf(titleTf, doc.title.len, index.avgTitleLen) +
          bm25Tf(bodyTf, doc.body.len, index.avgBodyLen));
    }
    return { article: doc.article, score, text: articleText(doc.article) };
  });
  return scored
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

export function retrieve(question: string, options: RetrieveOptions = {}): Hit[] {
  const corpus = options.corpus ?? DEMO_CORPUS;
  const k = options.k ?? 3;
  const titleWeight = options.titleWeight ?? 0;
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
    return retrieveBm25(corpus, q, k, titleWeight);
  }
  if (unit === "chunk") {
    return retrieveCountChunks(corpus, q, k, titleWeight);
  }
  return retrieveCountArticles(corpus, q, k, titleWeight);
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
  const corpus = options.corpus ?? DEMO_CORPUS;
  const k = options.k ?? 3;
  const titleWeight = options.titleWeight ?? 0;
  const unit = options.unit ?? "article";
  const q = tokenize(question);
  if (q.length === 0) return [];
  const embed = await import("./embed");
  const [queryVec, denseRows] = await Promise.all([
    embed.embedQuery(question),
    unit === "chunk" ? embed.chunkEmbeddings(corpus) : embed.articleEmbeddings(corpus),
  ]);
  const lexical =
    unit === "chunk"
      ? retrieveCountChunks(corpus, q, corpus.chunks.length, titleWeight)
      : retrieveCountArticles(corpus, q, corpus.articles.length, titleWeight);
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
  const refuseLine = options.refuseLine ?? REFUSE_LINE;
  const escalated =
    !options.alwaysAnswer && shouldEscalate(question, hits, options.ignoreTerms);
  if (escalated) {
    return {
      answer: refuseLine,
      citations: [],
      confident: false,
      usedLlm: false,
      escalated: true,
    };
  }
  if (hits.length === 0) {
    return {
      answer: refuseLine,
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
  const focus = new Set(tokenize(options.focus ?? ""));
  const overlap = (sentence: string, terms: Set<string>) =>
    tokenize(sentence).filter((t) => terms.has(t)).length;
  const ranked = [...sentences].sort(
    (a, b) => overlap(b, focus) - overlap(a, focus) || overlap(b, q) - overlap(a, q),
  );
  const picked = ranked.slice(0, 2).join(" ");
  return {
    answer: picked,
    citations: citationsFromHits(hits),
    confident: top.score >= CONFIDENT_MIN_SCORE,
    usedLlm: false,
    escalated: false,
  };
}
