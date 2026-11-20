/**
 * Multi-turn follow-ups for the Nimbus widget, MTRAG-style categories.
 *
 *   npx --yes tsx eval/conversations.ts
 *
 * Keyless. Replays each conversation through answerQuestion with the real
 * replies as history and writes eval/conversations.json. The same set gates
 * PRs as the relaydesk-conversations experiment (eval/suite.ts).
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { answerQuestion } from "../src/lib/graph";
import { forceExtractiveAnswers } from "../src/lib/keyless";
import { loadConversations, replayConversation, turnFailure } from "./conversation-set";

type Tally = { pass: number; total: number };

forceExtractiveAnswers();

async function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const conversations = loadConversations(join(here, "conversations.jsonl"));

  const byCategory = new Map<string, Tally>();
  const failures: { id: string; turn: number; visitor: string; reason: string }[] = [];

  for (const conversation of conversations) {
    const outcomes = await replayConversation(
      conversation.turns.map((t) => t.visitor),
      (question, history) => answerQuestion(question, { history }),
    );
    for (const [index, turn] of conversation.turns.entries()) {
      if (!turn.expect) continue;
      const outcome = outcomes[index];
      const reason = turnFailure(turn.expect, outcome);
      const tally = byCategory.get(conversation.category) ?? { pass: 0, total: 0 };
      tally.total += 1;
      if (!reason) tally.pass += 1;
      byCategory.set(conversation.category, tally);
      if (reason) failures.push({ id: conversation.id, turn: index + 1, visitor: turn.visitor, reason });
      console.log(
        (reason ? "FAIL" : "pass").padEnd(5),
        conversation.category.padEnd(15),
        `${conversation.id}#${index + 1}`.padEnd(24),
        reason ?? outcome.label,
      );
    }
  }

  const total = [...byCategory.values()].reduce(
    (sum, t) => ({ pass: sum.pass + t.pass, total: sum.total + t.total }),
    { pass: 0, total: 0 },
  );
  console.log("");
  for (const [category, tally] of byCategory) {
    console.log(category.padEnd(15), `${tally.pass}/${tally.total}`);
  }
  console.log("total".padEnd(15), `${total.pass}/${total.total}`);

  writeFileSync(
    join(here, "conversations.json"),
    `${JSON.stringify({ categories: Object.fromEntries(byCategory), total, failures }, null, 2)}\n`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
