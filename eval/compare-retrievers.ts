/**
 * Hit@k vs expected_slug for article count vs paragraph chunks. OOS rows have an empty slug.
 *
 *   npx --yes tsx eval/compare-retrievers.ts
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CHUNKS, retrieve, type RetrieveUnit } from "../src/lib/rag";
import { loadGolden } from "./golden";

async function topSlugs(question: string, unit: RetrieveUnit = "article"): Promise<string[]> {
  const hits = retrieve(question, { mode: "count", k: 3, titleWeight: 4, unit });
  return [...new Set(hits.map((item) => item.article.slug))];
}

async function hitAt(
  rows: { question: string; slug: string }[],
  k: number,
  unit: RetrieveUnit = "article",
): Promise<{ hit: number; labeled: number; misses: string[] }> {
  let hit = 0;
  let labeled = 0;
  const misses: string[] = [];
  for (const row of rows) {
    if (!row.slug) continue;
    labeled += 1;
    const slugs = (await topSlugs(row.question, unit)).slice(0, k);
    if (slugs.includes(row.slug)) hit += 1;
    else misses.push(row.question);
  }
  return { hit, labeled, misses };
}

async function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const rows = loadGolden(join(here, "golden.csv"));
  const labeled = rows.filter((row) => row.slug);

  console.log(
    `Chunks: ${CHUNKS.length} from ${new Set(CHUNKS.map((c) => c.article.slug)).size} articles\n`,
  );
  console.log("Count article vs count chunk, labeled rows where top-3 slugs differ\n");
  for (const row of labeled) {
    const article = await topSlugs(row.question, "article");
    const chunk = await topSlugs(row.question, "chunk");
    if (article.join() === chunk.join()) continue;
    console.log(`Q: ${row.question}`);
    console.log(`  expected  ${row.slug}`);
    console.log(`  article   ${article.join(", ")}`);
    console.log(`  chunk     ${chunk.join(", ")}`);
    console.log("");
  }

  for (const cfg of [
    { label: "count", unit: "article" as const },
    { label: "chunked", unit: "chunk" as const },
  ]) {
    const at1 = await hitAt(rows, 1, cfg.unit);
    const at3 = await hitAt(rows, 3, cfg.unit);
    const pct = (part: { hit: number; labeled: number }) =>
      `${part.hit}/${part.labeled} (${((100 * part.hit) / part.labeled).toFixed(1)}%)`;
    console.log(`${cfg.label.padEnd(8)}  hit@1 ${pct(at1)}  hit@3 ${pct(at3)}`);
    if (at1.misses.length) console.log(`  hit@1 misses: ${at1.misses.join(" | ")}`);
    if (at3.misses.length) console.log(`  hit@3 misses: ${at3.misses.join(" | ")}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
