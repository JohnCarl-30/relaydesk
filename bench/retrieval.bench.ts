import { bench, describe } from "vitest";
import { ARTICLES } from "../src/lib/articles";
import { chunkArticles } from "../src/lib/chunks";
import {
  buildCorpus,
  extractiveAnswer,
  retrieve,
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
