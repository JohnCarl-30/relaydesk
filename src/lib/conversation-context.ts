import { isVisitorEscalation } from "./escalate";
import { tokenize } from "./tokenize";

export type ConversationTurn = {
  role: "visitor" | "assistant" | "agent";
  body: string;
};

export type StandaloneQuestion = {
  /** Earlier questions only, for finding the article the conversation is on. */
  earlier: string;
  /** Earlier questions plus the follow-up, unlabeled, for retrieval and coverage. */
  search: string;
  /** The same questions labeled for the model, so it knows which one to answer. */
  prompt: string;
};

export const ACKNOWLEDGEMENT_REPLY = "Glad to help. Anything else about Nimbus?";

const MAX_HISTORY_TURNS = 6;
const MAX_TURN_CHARS = 600;
const MAX_HISTORY_CHARS = 2_400;

const CONTEXT_REFERENCE =
  /\b(it|its|that|this|they|them|their|those|these|same|former|latter)\b/i;
const CONTEXT_OPENING = /^(and|also|but|what about|how about)\b/i;
const STANDALONE_OPENING = /^(is|are|do|does|can|could|where|when|why)\b/i;

// "Thanks", "ok great", "got it, perfect": nothing to retrieve, nothing to escalate.
const ACKNOWLEDGEMENTS = new Set([
  "alright",
  "appreciate",
  "appreciated",
  "awesome",
  "cheers",
  "cool",
  "good",
  "got",
  "great",
  "helped",
  "helpful",
  "helps",
  "nice",
  "noted",
  "ok",
  "okay",
  "perfect",
  "sense",
  "thank",
  "thanks",
  "thx",
  "ty",
  "understood",
]);
const ACKNOWLEDGEMENT_FILLER = new Set([
  "a",
  "all",
  "it",
  "lot",
  "makes",
  "much",
  "right",
  "s",
  "so",
  "sounds",
  "super",
  "that",
  "very",
  "you",
]);

const COMMON_SENTENCE_WORDS = new Set([
  "Actually",
  "Also",
  "And",
  "Are",
  "But",
  "Can",
  "Could",
  "Did",
  "Do",
  "Does",
  "Hello",
  "Hey",
  "How",
  "I",
  "Is",
  "My",
  "Our",
  "Please",
  "Should",
  "Sorry",
  "The",
  "These",
  "This",
  "Those",
  "What",
  "When",
  "Where",
  "Which",
  "Why",
  "Will",
  "Would",
  "Yes",
  "Your",
]);

export function isAcknowledgement(text: string): boolean {
  const words = text.toLowerCase().match(/[a-z]+/g) ?? [];
  return (
    words.some((word) => ACKNOWLEDGEMENTS.has(word)) &&
    words.every((word) => ACKNOWLEDGEMENTS.has(word) || ACKNOWLEDGEMENT_FILLER.has(word))
  );
}

export function boundConversationHistory(
  history: ConversationTurn[],
): ConversationTurn[] {
  const selected: ConversationTurn[] = [];
  let remaining = MAX_HISTORY_CHARS;

  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (selected.length >= MAX_HISTORY_TURNS || remaining <= 0) break;
    const turn = history[index];
    const body = turn.body.trim().slice(0, Math.min(MAX_TURN_CHARS, remaining));
    if (!body) continue;
    selected.unshift({ role: turn.role, body });
    remaining -= body.length;
  }

  return selected;
}

function readsLikeFollowUp(question: string): boolean {
  const trimmed = question.trim();
  if (!trimmed) return false;
  if (STANDALONE_OPENING.test(trimmed) && !CONTEXT_REFERENCE.test(trimmed)) {
    return false;
  }
  return (
    CONTEXT_OPENING.test(trimmed) ||
    CONTEXT_REFERENCE.test(trimmed) ||
    tokenize(trimmed).length <= 2
  );
}

export function needsConversationContext(
  question: string,
  history: ConversationTurn[],
): boolean {
  if (!history.some((turn) => turn.role === "visitor")) return false;
  return readsLikeFollowUp(question);
}

/**
 * Visitor questions a follow-up leans on, oldest first. Walks back past earlier
 * follow-ups ("what about Scale?") to the last question that stands on its own,
 * so a chain of follow-ups keeps the original topic.
 */
function earlierQuestions(history: ConversationTurn[]): string[] {
  const questions = history
    .filter((turn) => turn.role === "visitor")
    .map((turn) => turn.body.trim())
    .filter(
      (body) => body && !isVisitorEscalation(body) && !isAcknowledgement(body),
    );
  const chain: string[] = [];
  for (let index = questions.length - 1; index >= 0; index -= 1) {
    chain.unshift(questions[index]);
    if (!readsLikeFollowUp(questions[index])) break;
  }
  return chain;
}

export function fallbackStandaloneQuestion(
  question: string,
  history: ConversationTurn[],
): StandaloneQuestion | null {
  const earlier = earlierQuestions(history);
  if (earlier.length === 0) return null;
  const followUp = question.trim();
  return {
    earlier: earlier.join("\n"),
    search: [...earlier, followUp].join("\n"),
    prompt: [
      ...earlier.map((body) => `Previous question: ${body}`),
      `Follow-up question: ${followUp}`,
    ].join("\n"),
  };
}

function isFillerWord(word: string): boolean {
  const normalized = word.toLowerCase();
  return (
    COMMON_SENTENCE_WORDS.has(word) ||
    ACKNOWLEDGEMENTS.has(normalized) ||
    ACKNOWLEDGEMENT_FILLER.has(normalized) ||
    CONTEXT_REFERENCE.test(normalized) ||
    tokenize(normalized).length === 0
  );
}

/**
 * Named subjects in a follow-up ("Scale", "Okta", "about hubspot") that the
 * evidence must mention. Quantities and verbs ("20 seats", "to wait") are left
 * out; they refine the earlier topic rather than change it.
 */
export function explicitAnchors(question: string): string[] {
  const capitalized = question.match(/\b[A-Z][A-Za-z0-9-]{2,}\b/g) ?? [];
  const contextualSubjects = [
    ...question.matchAll(/\b(?:about|with|via|using)\s+([a-z0-9][a-z0-9.-]{2,})\b/gi),
  ].map((match) => match[1]);
  const seen = new Set<string>();

  return [...capitalized, ...contextualSubjects].filter((word) => {
    if (isFillerWord(word)) return false;
    const normalized = word.toLowerCase();
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

/**
 * Moves the article the conversation is already on to the front when it
 * mentions every content word of the follow-up, so "and Starter?" after a
 * plan-quota question stays on plan quotas instead of jumping to whichever
 * article also names Starter in its title.
 */
export function preferTopic<T extends { article: { slug: string }; text: string }>(
  hits: T[],
  topicSlug: string | undefined,
  followUp: string,
): T[] {
  const index = hits.findIndex((hit) => hit.article.slug === topicSlug);
  if (index <= 0) return hits;
  const topicWords = new Set(tokenize(hits[index].text));
  const covered = tokenize(followUp)
    .filter((word) => !isFillerWord(word))
    .every((word) => topicWords.has(word));
  if (!covered) return hits;
  return [hits[index], ...hits.slice(0, index), ...hits.slice(index + 1)];
}

function anchorForms(value: string): string[] {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]/g, "");
  const forms = new Set([normalized]);
  if (normalized.length > 5 && normalized.endsWith("tion")) {
    forms.add(normalized.slice(0, -3));
  }
  if (normalized.length > 5 && normalized.endsWith("ing")) {
    forms.add(normalized.slice(0, -3));
  }
  if (normalized.length > 4 && normalized.endsWith("ed")) {
    forms.add(normalized.slice(0, -2));
  }
  if (normalized.length > 4 && normalized.endsWith("s")) {
    forms.add(normalized.slice(0, -1));
  }
  if (normalized.length > 4 && normalized.endsWith("e")) {
    forms.add(normalized.slice(0, -1));
  }
  return [...forms].filter(Boolean);
}

export function unsupportedExplicitAnchors(
  question: string,
  evidence: { text: string }[],
): string[] {
  const searchable = evidence.map((item) => item.text).join("\n").toLowerCase();
  const evidenceForms = new Set(tokenize(searchable).flatMap(anchorForms));
  return explicitAnchors(question).filter((anchor) => {
    if (searchable.includes(anchor.toLowerCase())) return false;
    return !anchorForms(anchor).some((form) => evidenceForms.has(form));
  });
}
