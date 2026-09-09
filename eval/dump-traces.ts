/**
 * Write extractive traces for the golden CSV (same work as POST /api/eval).
 *
 *   npx --yes tsx eval/dump-traces.ts > /tmp/nimbus.jsonl
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { extractiveAnswer, retrieve } from "../src/lib/rag";
import { loadGolden } from "./golden";

const here = dirname(fileURLToPath(import.meta.url));
const rows = loadGolden(join(here, "golden.csv"));
for (const row of rows) {
  const hits = retrieve(row.question);
  const rag = extractiveAnswer(row.question, hits);
  process.stdout.write(
    `${JSON.stringify({
      question: row.question,
      ground_truth: row.groundTruth,
      answer: rag.answer,
      retrieved_contexts: hits.map((hit) => hit.text),
    })}\n`,
  );
}
