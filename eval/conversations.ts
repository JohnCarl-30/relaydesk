import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ACKNOWLEDGEMENT_REPLY, type ConversationTurn } from "../src/lib/conversation-context";
import { answerQuestion } from "../src/lib/graph";
import type { RagResult } from "../src/lib/rag";

type Expect = { slug?: string | string[]; escalated?: boolean; ack?: boolean };

type Conversation = {
  id: string;
  category: string;
  why: string;
  turns: { visitor: string; expect?: Expect }[];
};

type Tally = { pass: number; total: number };

// Keyless and reproducible, like the other eval scripts.
delete process.env.OPENAI_API_KEY;
delete process.env.RELAYDESK_STUB_LLM;
process.env.RELAYDESK_TRACE_FILE ??= "0";

function describe(result: RagResult): string {
  if (result.answer === ACKNOWLEDGEMENT_REPLY) return "ack";
  if (result.escalated) return "escalated";
  return result.citations[0]?.slug ?? "no citation";
}

function failure(expect: Expect, result: RagResult): string | null {
  const got = describe(result);
  if (expect.ack) return got === "ack" ? null : `want ack, got ${got}`;
  if (expect.escalated !== undefined && result.escalated !== expect.escalated) {
    return `want escalated=${expect.escalated}, got ${got}`;
  }
  if (expect.slug) {
    const allowed = [expect.slug].flat();
    if (!allowed.includes(got)) return `want ${allowed.join(" or ")}, got ${got}`;
  }
  return null;
}

async function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const conversations = readFileSync(join(here, "conversations.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Conversation);

  const byCategory = new Map<string, Tally>();
  const failures: { id: string; turn: number; visitor: string; reason: string }[] = [];

  for (const conversation of conversations) {
    const history: ConversationTurn[] = [];
    for (const [index, turn] of conversation.turns.entries()) {
      const result = await answerQuestion(turn.visitor, { history: [...history] });
      history.push(
        { role: "visitor", body: turn.visitor },
        { role: "assistant", body: result.answer },
      );
      if (!turn.expect) continue;

      const reason = failure(turn.expect, result);
      const tally = byCategory.get(conversation.category) ?? { pass: 0, total: 0 };
      tally.total += 1;
      if (!reason) tally.pass += 1;
      byCategory.set(conversation.category, tally);
      if (reason) failures.push({ id: conversation.id, turn: index + 1, visitor: turn.visitor, reason });
      console.log(
        (reason ? "FAIL" : "pass").padEnd(5),
        conversation.category.padEnd(15),
        `${conversation.id}#${index + 1}`.padEnd(24),
        reason ?? describe(result),
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

main();
