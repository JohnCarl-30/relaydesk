import { CONFIDENT_MIN_SCORE, shouldEscalate, type ScoredText } from "./escalate";
import { retrieve, type Hit } from "./rag";
import { tokenize } from "./tokenize";

/**
 * Keyless stand-in for the rewrite node. Same tokens retrieve already uses,
 * so a second pass does not change the ranking. The widget still calls the
 * model when OPENAI_API_KEY is set.
 */
export function rewriteSearchQuery(question: string): string {
  const tokens = tokenize(question);
  return tokens.length > 0 ? tokens.join(" ") : question;
}

export function shouldRewrite(question: string, hits: ScoredText[]): boolean {
  if (shouldEscalate(question, hits)) return false;
  if (hits.length === 0) return false;
  return (hits[0]?.score ?? 0) < CONFIDENT_MIN_SCORE;
}

export function retrieveMaybeRewrite(question: string): {
  hits: Hit[];
  rewrote: boolean;
  query: string;
} {
  const first = retrieve(question);
  if (!shouldRewrite(question, first)) {
    return { hits: first, rewrote: false, query: question };
  }
  const query = rewriteSearchQuery(question);
  const second = retrieve(query);
  return {
    hits: second.length > 0 ? second : first,
    rewrote: true,
    query,
  };
}
