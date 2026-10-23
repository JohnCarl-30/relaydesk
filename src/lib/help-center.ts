import { acknowledgementReply } from "./conversation-context";
import { refuseLine } from "./escalate";
import { DEMO_CORPUS, type Corpus } from "./rag";
import { tokenize } from "./tokenize";

export const DEMO_BUSINESS_ID = "nimbus";
export const DEMO_BUSINESS_NAME = "Nimbus";

/** One business's help center as the answer graph and the co-pilot see it. */
export type HelpCenter = {
  businessId: string;
  name: string;
  corpus: Corpus;
  /** Last line of the rewrite prompt: which words a search query must keep. */
  searchHint: string;
};

export const GENERIC_SEARCH_HINT = "Keep the product words the visitor used.";

/** Nimbus from the articles in code. Evals and unit tests answer from this. */
export const DEMO_HELP_CENTER: HelpCenter = {
  businessId: DEMO_BUSINESS_ID,
  name: DEMO_BUSINESS_NAME,
  corpus: DEMO_CORPUS,
  searchHint: "Keep product words like seats, SSO, invoice, funnel, API key.",
};

export function centerRefuseLine(center: HelpCenter): string {
  return refuseLine(center.name);
}

export function centerAcknowledgement(center: HelpCenter): string {
  return acknowledgementReply(center.name);
}

/** The business's name says nothing about which article a question needs. */
export function nameTerms(center: HelpCenter): string[] {
  return tokenize(center.name);
}

export function articleBySlug(center: HelpCenter, slug: string) {
  return center.corpus.articles.find((article) => article.slug === slug);
}

/** Messages store citations by title; a renamed article has no slug any more. */
export function slugForTitle(center: HelpCenter, title: string): string | null {
  return center.corpus.articles.find((article) => article.title === title)?.slug ?? null;
}
