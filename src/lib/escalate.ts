import { tokenize } from "./tokenize";

export { tokenize } from "./tokenize";

export const CONFIDENT_MIN_SCORE = 6;
export const COVERAGE_ESCALATE_BELOW = 0.5;
export const PENDING_TICKET_EMAIL = "unassigned@nimbus.demo";
export const REFUSE_LINE = "I don't have that in the Nimbus help center.";

// Requests for a person. Each phrase needs an intent ("talk to", "need a",
// "please"), so a question that only mentions a person or an agent ("a
// person's email", "the user agent filter") stays a question.
const VISITOR_ESCALATE = new RegExp(
  [
    String.raw`this did(?:n'?t| not) help`,
    String.raw`\b(?:talk|speak|chat)\s+(?:to|with)\s+(?:(?:a|an)\s+)?(?:real\s+|live\s+)?(?:person|human|someone|somebody|agent|representative|rep|staff)\b`,
    String.raw`\b(?:need|want|get me|give me)\s+(?:a|an)\s+(?:real\s+person|live\s+(?:person|agent)|human(?:\s+agent)?|representative)\b(?!')`,
    String.raw`\b(?:human|person|agent|representative)\s+please\b`,
    String.raw`\bopen a ticket\b`,
  ].join("|"),
  "i",
);

export type ScoredText = {
  score: number;
  text: string;
};

export function isVisitorEscalation(text: string): boolean {
  return VISITOR_ESCALATE.test(text.trim());
}

export function questionCoverage(question: string, hitText: string): number {
  const q = tokenize(question).filter((t) => t !== "nimbus");
  if (q.length === 0) return 1;
  const hit = new Set(tokenize(hitText));
  return q.filter((t) => hit.has(t)).length / q.length;
}

/**
 * Open a ticket instead of quoting an article.
 * Empty hits, visitor asked for a human, or a weak retrieve whose top hit
 * barely overlaps the question (Salesforce scoring 5 against workspaces).
 */
export function shouldEscalate(question: string, hits: ScoredText[]): boolean {
  if (isVisitorEscalation(question)) return true;
  if (hits.length === 0) return true;
  const top = hits[0];
  if (top.score >= CONFIDENT_MIN_SCORE) return false;
  return questionCoverage(question, top.text) < COVERAGE_ESCALATE_BELOW;
}

// "how much" asks a price only when a verb follows ("how much does it…");
// "how much raw data" or "how much of it" ask a quantity. "charged" and
// "in charge" are billing and role questions the help center can answer.
const PRICE_QUESTION =
  /\b(?:cost|costs|price|prices|pricing|fee|fees)\b|\bhow much (?:does|do|is|are|will|would)\b/i;
const PRICE_EVIDENCE = /\$\s?\d|\b(fee|fees|charge|charges|charged|cost|costs|price|prices|pricing)\b/i;

/**
 * A price question answered from an article with no price in it quotes the
 * wrong thing. The help center lists the overage rate and fees, not plan or
 * seat prices, so "how much does it cost?" after an SSO question should reach
 * a person.
 */
export function unsupportedPriceQuestion(
  question: string,
  answerSource: { text: string } | undefined,
): boolean {
  return PRICE_QUESTION.test(question) && !PRICE_EVIDENCE.test(answerSource?.text ?? "");
}
