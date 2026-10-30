import { bench, describe } from "vitest";
import { ARTICLES } from "../src/lib/articles";
import { chunkArticles } from "../src/lib/chunks";
import {
  buildCorpus,
  DEMO_CORPUS,
  extractiveAnswer,
  fuseRrf,
  retrieve,
  retrieveDenseFromVecs,
} from "../src/lib/rag";
import { tokenize } from "../src/lib/tokenize";
import { GOLDEN_QUESTIONS } from "./fixtures";

// A larger help center, so index building and scoring are measured on more than the demo's handful of articles.
const LARGE_ARTICLES = Array.from({ length: 10 }, (_, copy) =>
  ARTICLES.map((article) => ({ ...article, slug: `${article.slug}-${copy}` })),
).flat();
const LARGE_CORPUS = buildCorpus(LARGE_ARTICLES);

describe("tokenize", () => {
  const allBodies = ARTICLES.map((a) => a.body).join("\n\n");

  bench("golden questions", () => {
    for (const question of GOLDEN_QUESTIONS) tokenize(question);
  });

  bench("whole help center", () => {
    tokenize(allBodies);
  });
});

describe("index", () => {
  bench("chunkArticles demo", () => {
    chunkArticles(ARTICLES);
  });

  bench("buildCorpus demo", () => {
    buildCorpus(ARTICLES);
  });

  bench("buildCorpus 10x", () => {
    buildCorpus(LARGE_ARTICLES);
  });
});

describe("retrieve golden set", () => {
  bench("count/article", () => {
    for (const question of GOLDEN_QUESTIONS) retrieve(question);
  });

  bench("count/chunk", () => {
    for (const question of GOLDEN_QUESTIONS) retrieve(question, { unit: "chunk" });
  });

  bench("bm25/article", () => {
    for (const question of GOLDEN_QUESTIONS) retrieve(question, { mode: "bm25" });
  });

  bench("bm25/article 10x corpus", () => {
    for (const question of GOLDEN_QUESTIONS) {
      retrieve(question, { mode: "bm25", corpus: LARGE_CORPUS });
    }
  });
});

describe("answer", () => {
  const hitsPerQuestion = GOLDEN_QUESTIONS.map((question) => ({
    question,
    hits: retrieve(question),
  }));

  bench("extractiveAnswer golden set", () => {
    for (const { question, hits } of hitsPerQuestion) extractiveAnswer(question, hits);
  });

  bench("retrieve + extractiveAnswer golden set", () => {
    for (const question of GOLDEN_QUESTIONS) extractiveAnswer(question, retrieve(question));
  });
});

describe("hybrid fusion", () => {
  // Deterministic pseudo-embeddings, so dense scoring and RRF fusion run without loading a model.
  const DIM = 384;
  let seed = 42;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648 - 0.5;
  };
  const vec = () => Array.from({ length: DIM }, rand);
  const rows = DEMO_CORPUS.chunks.map((chunk) => ({
    article: chunk.article,
    vec: vec(),
    text: chunk.text,
    chunkId: chunk.id,
  }));
  const queryVecs = GOLDEN_QUESTIONS.map(() => vec());
  const lexical = GOLDEN_QUESTIONS.map((question) =>
    retrieve(question, { unit: "chunk", k: DEMO_CORPUS.chunks.length }),
  );

  bench("dense scoring + fuseRrf golden set", () => {
    queryVecs.forEach((queryVec, i) => {
      fuseRrf(lexical[i], retrieveDenseFromVecs(queryVec, rows), 3);
    });
  });
});
