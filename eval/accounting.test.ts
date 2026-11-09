import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { parseJsonArticles } from "../src/lib/article-import";
import { answerQuestion } from "../src/lib/graph";
import { GENERIC_SEARCH_HINT, type HelpCenter } from "../src/lib/help-center";
import { forceExtractiveAnswers } from "../src/lib/keyless";
import { buildCorpus } from "../src/lib/rag";

forceExtractiveAnswers();

// The accounting-firm template, loaded the way a firm imports it in Articles.
const here = dirname(fileURLToPath(import.meta.url));
const articles = parseJsonArticles(readFileSync(join(here, "../templates/accounting-ph.json"), "utf8"));
const center: HelpCenter = {
  businessId: "tala",
  name: "Tala Accounting",
  corpus: buildCorpus(articles),
  searchHint: GENERIC_SEARCH_HINT,
};

// What clients of a Philippine accounting firm ask, and the article that answers it.
const ANSWERED: [string, string][] = [
  ["When is the quarterly VAT return due?", "bir-deadlines"],
  ["When is the deadline for 1701Q?", "bir-deadlines"],
  ["When do I need to send my receipts?", "document-cutoff"],
  ["How do I send you my documents?", "send-documents"],
  ["I received a letter of authority from the BIR, what do I do?", "bir-letter"],
  ["What do you need to register my new business with the BIR?", "register-business"],
  ["Do I still issue official receipts or invoices now?", "invoices-vs-receipts"],
  ["Should I choose the 8% income tax rate?", "eight-percent"],
  ["What does the monthly retainer cover?", "fees-retainer"],
  ["How do I pay the tax due?", "paying-tax"],
  ["What is the penalty for filing late?", "late-penalties"],
  ["When will my employees get their Form 2316?", "payroll-2316"],
  ["How do I close my business?", "close-business"],
];

describe("accounting-firm template", () => {
  it("imports as a valid help center", () => {
    assert.equal(articles.length, 12);
  });

  for (const [question, slug] of ANSWERED) {
    it(`answers "${question}" from ${slug}`, async () => {
      const result = await answerQuestion(question, { helpCenter: center, rewrite: false });
      assert.equal(result.escalated, false, result.answer);
      assert.equal(result.citations[0]?.slug, slug, result.answer);
    });
  }

  // General questions that look like the client-specific ones below.
  for (const [question, slug] of [
    ["When is my VAT return due?", "bir-deadlines"],
    ["How do I send my payroll summary?", "payroll-2316"],
  ]) {
    it(`still answers "${question}" from ${slug}`, async () => {
      const result = await answerQuestion(question, { helpCenter: center, rewrite: false });
      assert.equal(result.escalated, false, result.answer);
      assert.equal(result.citations[0]?.slug, slug, result.answer);
    });
  }

  for (const question of [
    // Nothing in the template covers these.
    "Can you do my SEC general information sheet?",
    "Can you remit my SSS contributions?",
    "I want to talk to a person",
    // The client's own records: only staff can see them.
    "Did you already file my VAT for Q3?",
    "How much tax do I owe this quarter?",
    "Can you send me my 2316?",
    "What's the status of my registration?",
  ]) {
    it(`opens a ticket for "${question}"`, async () => {
      const result = await answerQuestion(question, { helpCenter: center, rewrite: false });
      assert.equal(result.escalated, true, result.answer);
    });
  }

  // Known gap: "tax" is in half the articles, so a tax the template doesn't
  // cover still scores as a confident match. Ignoring such common words fixes
  // these but also hands "When exactly do old events get wiped each day?" to a
  // person on Nimbus, whose article answers it in other words, which fails
  // the escalation-precision gate. Word counting can't tell the two apart.
  for (const question of [
    "Do you handle real property tax at city hall?",
    "Can you process my estate tax?",
    "Do you prepare donor's tax returns?",
    "Do you do tax planning for my startup?",
  ]) {
    it(`opens a ticket for "${question}"`, { todo: "a common word alone scores as a match" }, async () => {
      const result = await answerQuestion(question, { helpCenter: center, rewrite: false });
      assert.equal(result.escalated, true, result.answer);
    });
  }
});
