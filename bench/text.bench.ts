import { bench, describe } from "vitest";
import { ARTICLES } from "../src/lib/articles";
import { parseJsonArticles, parseMarkdownArticles, slugify } from "../src/lib/article-import";
import {
  boundConversationHistory,
  explicitAnchors,
  heuristicStandaloneQuestion,
  needsConversationContext,
  unsupportedExplicitAnchors,
} from "../src/lib/conversation-context";
import { questionCoverage, shouldEscalate } from "../src/lib/escalate";
import { retrieve } from "../src/lib/rag";
import { redactText } from "../src/lib/redact";
import { ESCALATION_QUESTIONS, FOLLOW_UPS, GOLDEN_QUESTIONS } from "./fixtures";

describe("escalation", () => {
  const cases = [...GOLDEN_QUESTIONS, ...ESCALATION_QUESTIONS].map((question) => ({
    question,
    hits: retrieve(question),
  }));

  bench("shouldEscalate golden + escalation sets", () => {
    for (const { question, hits } of cases) shouldEscalate(question, hits);
  });

  bench("questionCoverage golden + escalation sets", () => {
    for (const { question, hits } of cases) {
      if (hits[0]) questionCoverage(question, hits[0].text);
    }
  });
});

describe("conversation context", () => {
  const evidence = FOLLOW_UPS.map(({ question }) => retrieve(question));

  bench("needsConversationContext", () => {
    for (const { question, history } of FOLLOW_UPS) needsConversationContext(question, history);
  });

  bench("heuristicStandaloneQuestion", () => {
    for (const { question, history } of FOLLOW_UPS) heuristicStandaloneQuestion(question, history);
  });

  bench("explicitAnchors", () => {
    for (const { question } of FOLLOW_UPS) explicitAnchors(question);
  });

  bench("unsupportedExplicitAnchors", () => {
    FOLLOW_UPS.forEach(({ question }, i) => unsupportedExplicitAnchors(question, evidence[i]));
  });

  bench("boundConversationHistory", () => {
    for (const { history } of FOLLOW_UPS) boundConversationHistory(history);
  });
});

describe("redact", () => {
  const transcript = Array.from(
    { length: 50 },
    (_, i) =>
      `Visitor ${i}: my email is jane.doe+${i}@example.com, call me at +1 (555) 010-${String(1000 + i)}. ` +
      `Card 4111 1111 1111 ${String(1000 + i)} was charged twice. Session 3f2b8c1a-7348-4105-9648-0c2d${String(10000000 + i)} ` +
      `shows 10,000,000 events in project ${i}.`,
  ).join("\n");

  bench("redactText chat transcript", () => {
    redactText(transcript);
  });

  bench("redactText help center (no PII)", () => {
    for (const article of ARTICLES) redactText(article.body);
  });
});

describe("article import", () => {
  const markdown = ["# Imported"]
    .concat(
      Array.from({ length: 5 }, (_, copy) =>
        ARTICLES.map((a) => `## Copy ${copy}: ${a.title}\n\n${a.body}\n`),
      ).flat(),
    )
    .join("\n");
  const json = JSON.stringify(
    Array.from({ length: 5 }, (_, copy) =>
      ARTICLES.map((a) => ({ title: `Copy ${copy}: ${a.title}`, category: a.category, body: a.body })),
    ).flat(),
  );

  bench("parseMarkdownArticles", () => {
    parseMarkdownArticles(markdown);
  });

  bench("parseJsonArticles", () => {
    parseJsonArticles(json);
  });

  bench("slugify titles", () => {
    for (const article of ARTICLES) slugify(article.title);
  });
});
