/**
 * The multi-turn set in conversations.jsonl: loading it, replaying a
 * conversation through the widget, and grading each turn. Shared by
 * eval/conversations.ts (by hand) and the relaydesk-conversations experiment.
 */
import { readFileSync } from "node:fs";
import { ACKNOWLEDGEMENT_REPLY, type ConversationTurn } from "../src/lib/conversation-context";
import type { RagResult } from "../src/lib/rag";

/** What one turn should do: cite one of these slugs, escalate or not, or get the acknowledgement reply. */
export type TurnExpect = { slug?: string | string[]; escalated?: boolean; ack?: boolean };

export type Conversation = {
  id: string;
  category: string;
  why: string;
  turns: { visitor: string; expect?: TurnExpect }[];
};

/** What the widget did on one turn, reduced to what the expectations check. */
export type TurnOutcome = {
  visitor: string;
  /** "ack", "escalated", the first cited slug, or "no citation". */
  label: string;
  escalated: boolean;
};

export function loadConversations(path: string): Conversation[] {
  return readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Conversation);
}

export function outcomeLabel(result: RagResult): string {
  if (result.answer === ACKNOWLEDGEMENT_REPLY) return "ack";
  if (result.escalated) return "escalated";
  return result.citations[0]?.slug ?? "no citation";
}

/** Why a turn failed its expectation, or null when it passed. */
export function turnFailure(expect: TurnExpect, outcome: Pick<TurnOutcome, "label" | "escalated">): string | null {
  const got = outcome.label;
  if (expect.ack) return got === "ack" ? null : `want ack, got ${got}`;
  if (expect.escalated !== undefined && outcome.escalated !== expect.escalated) {
    return `want escalated=${expect.escalated}, got ${got}`;
  }
  if (expect.slug) {
    const allowed = [expect.slug].flat();
    if (!allowed.includes(got)) return `want ${allowed.join(" or ")}, got ${got}`;
  }
  return null;
}

type Answer = (question: string, history: ConversationTurn[]) => Promise<RagResult>;

/** Sends each visitor turn with the widget's real earlier replies as history, the way the widget does. */
export async function replayConversation(visitorTurns: string[], answer: Answer): Promise<TurnOutcome[]> {
  const history: ConversationTurn[] = [];
  const outcomes: TurnOutcome[] = [];
  for (const visitor of visitorTurns) {
    const result = await answer(visitor, [...history]);
    history.push({ role: "visitor", body: visitor }, { role: "assistant", body: result.answer });
    outcomes.push({ visitor, label: outcomeLabel(result), escalated: result.escalated });
  }
  return outcomes;
}
