/**
 * Inbox co-pilot triage on realistic tickets.
 *
 *   npx --yes tsx eval/copilot.ts
 *
 * Keyless. Replays each conversation through answerQuestion the way the chat
 * route does (opening a ticket on escalation), runs the co-pilot, and checks
 * why the ticket exists, its topic, and which question it is about. Uses a
 * temporary database and writes eval/copilot.json.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readTicket, runCopilot } from "../src/lib/copilot";
import * as db from "../src/lib/db";
import { answerQuestion } from "../src/lib/graph";
import { forceExtractiveAnswers } from "../src/lib/keyless";

type Expect = { reason: string; topic: string; question: string };
type Case = { id: string; why: string; visitor: string[]; expect: Expect };

forceExtractiveAnswers();
process.env.RELAYDESK_DB_PATH = join(tmpdir(), `relaydesk-copilot-eval-${process.pid}-${Date.now()}.db`);

async function replay(turns: string[]) {
  const conversation = db.createConversation(null);
  let ticket: db.Ticket | undefined;
  for (const text of turns) {
    const history = db.listMessages(conversation.id).map(({ role, body }) => ({ role, body }));
    db.addMessage(conversation.id, "visitor", text);
    const rag = await answerQuestion(text, { history });
    let reply = rag.answer;
    if (rag.escalated) {
      ticket ??= db.createTicket(conversation.id, "unassigned@nimbus.demo");
      reply = `${rag.answer}\n\nTicket ${ticket.id} is in the staff inbox.`;
    }
    db.addMessage(conversation.id, "assistant", reply, rag.citations.map((c) => c.title));
  }
  return ticket;
}

async function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const cases = readFileSync(join(here, "copilot-tickets.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Case);

  const fields = ["reason", "topic", "question"] as const;
  const tally = Object.fromEntries(fields.map((f) => [f, 0])) as Record<(typeof fields)[number], number>;
  const failures: { id: string; field: string; want: string; got: string }[] = [];

  for (const c of cases) {
    const ticket = await replay(c.visitor);
    if (!ticket) {
      failures.push({ id: c.id, field: "ticket", want: "a ticket", got: "no escalation" });
      console.log("FAIL ".padEnd(5), c.id.padEnd(24), "no ticket was opened");
      continue;
    }
    await runCopilot(ticket.id, "ticket_created");
    const filed = db.getTicket(ticket.id);
    const context = readTicket(ticket, db.listMessages(ticket.conversation_id));
    const got: Expect = { reason: context.reason, topic: filed?.topic ?? "", question: context.question };
    const misses = fields.filter((f) => got[f] !== c.expect[f]);
    for (const f of fields) if (!misses.includes(f)) tally[f] += 1;
    for (const f of misses) failures.push({ id: c.id, field: f, want: c.expect[f], got: got[f] });
    console.log(
      (misses.length ? "FAIL" : "pass").padEnd(5),
      c.id.padEnd(24),
      misses.length ? misses.map((f) => `${f}: want "${c.expect[f]}", got "${got[f]}"`).join("; ") : `${got.reason} · ${got.topic}`,
    );
  }

  console.log("");
  for (const f of fields) console.log(f.padEnd(10), `${tally[f]}/${cases.length}`);
  writeFileSync(
    join(here, "copilot.json"),
    `${JSON.stringify({ n: cases.length, correct: tally, failures }, null, 2)}\n`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
