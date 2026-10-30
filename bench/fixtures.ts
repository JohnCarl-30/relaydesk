import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ConversationTurn } from "../src/lib/conversation-context";
import { loadGolden } from "../eval/golden";
import { loadLabels } from "../eval/labels";

const evalDir = join(dirname(fileURLToPath(import.meta.url)), "..", "eval");

/** The 60 labeled visitor questions from the retrieval eval. */
export const GOLDEN_QUESTIONS = loadGolden(join(evalDir, "golden.csv")).map((row) => row.question);

/** The 23 labeled questions from the escalation eval. */
export const ESCALATION_QUESTIONS = loadLabels(join(evalDir, "escalation-labels.csv")).map(
  (row) => row.question,
);

type ConversationCase = { turns: { visitor: string }[] };

/** Each multi-turn conversation as (history, follow-up) pairs, for the follow-up heuristics. */
export const FOLLOW_UPS: { question: string; history: ConversationTurn[] }[] = readFileSync(
  join(evalDir, "conversations.jsonl"),
  "utf8",
)
  .trim()
  .split("\n")
  .flatMap((line) => {
    const { turns } = JSON.parse(line) as ConversationCase;
    return turns.slice(1).map((turn, i) => ({
      question: turn.visitor,
      history: turns
        .slice(0, i + 1)
        .flatMap((t): ConversationTurn[] => [
          { role: "visitor", body: t.visitor },
          { role: "assistant", body: "Here is what the help center says." },
        ]),
    }));
  });
