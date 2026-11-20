/**
 * Writes the answers a person labels to calibrate the faithfulness judge.
 *
 *   OPENAI_BASE_URL=http://localhost:11434/v1 OPENAI_API_KEY=ollama OPENAI_MODEL=qwen3:4b-instruct \
 *     npx --yes tsx eval/judge-candidates.ts                     # graph path, every golden row
 *   RELAYDESK_ANSWER_PATH=agent ... npx --yes tsx eval/judge-candidates.ts --limit 25
 *
 * Runs golden.csv questions through the widget's answer path and keeps the
 * answers the judge would score: model-written, not escalated, with at least
 * one citation. Appends them to eval/faithfulness-labels.json with
 * `label: null`; a person sets it to 1 (every claim is in the cited articles)
 * or 0. Existing rows, labeled or not, are never changed, and no judge scores
 * go in the file, so they can't anchor the labels.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { answerQuestion, chatModelName, hasLlm, type AnswerPath } from "../src/lib/graph";
import { loadGolden } from "./golden";
import { loadJson, rowKey, type LabeledAnswer } from "./judge-agreement";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "faithfulness-labels.json");
const path: AnswerPath = process.env.RELAYDESK_ANSWER_PATH === "agent" ? "agent" : "graph";
const limitArg = process.argv.indexOf("--limit");
const limit = limitArg === -1 ? Infinity : Number(process.argv[limitArg + 1]);

if (!hasLlm()) throw new Error("Set OPENAI_API_KEY (any value for Ollama) so the model writes the answers.");
if (!(limit > 0)) throw new Error("--limit needs a positive number.");

async function main() {
  const rows = loadJson<LabeledAnswer[]>(out, []);
  const seen = new Set(rows.map(rowKey));
  let added = 0;
  for (const { question } of loadGolden(join(here, "golden.csv"))) {
    if (added >= limit) break;
    if (seen.has(rowKey({ path, question }))) continue;
    try {
      const r = await answerQuestion(question, { path });
      if (!r.usedLlm || r.escalated || r.citations.length === 0) continue;
      rows.push({ question, answer: r.answer, citations: r.citations.map((c) => c.slug), model: chatModelName(), path, label: null, note: "" });
      added += 1;
      console.log(`kept ${added}: ${question}`);
    } catch (error) {
      console.log(`skipped (${(error as Error).message}): ${question}`);
    }
  }
  writeFileSync(out, `${JSON.stringify(rows, null, 2)}\n`);
  console.log(`added ${added} ${path} rows; ${rows.length} rows in ${out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
