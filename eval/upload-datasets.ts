/**
 * Uploads golden.csv, escalation-labels.csv, and intent-labels.csv as Langfuse datasets.
 *
 *   npx --yes tsx eval/upload-datasets.ts            # sync
 *   npx --yes tsx eval/upload-datasets.ts --dry-run  # print the plan only
 *
 * Reads LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY, and LANGFUSE_BASE_URL from
 * the environment or .env.local. Without both keys it prints the plan and
 * writes nothing. Items are upserted on a stable id, so reruns don't duplicate.
 * Rows removed from a CSV are archived, not deleted.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LangfuseAPIClient, NotFoundError } from "@langfuse/core";
import {
  ESCALATION_DATASET,
  GOLDEN_DATASET,
  INTENT_DATASET,
  escalationItems,
  goldenItems,
  intentItems,
  planSync,
  type DesiredItem,
  type ExistingItem,
  type SyncPlan,
} from "./datasets";
import { loadGolden } from "./golden";
import { loadIntentLabels, loadLabels } from "./labels";

type DatasetSpec = {
  name: string;
  description: string;
  items: DesiredItem[];
};

async function ensureDataset(client: LangfuseAPIClient, spec: DatasetSpec) {
  try {
    await client.datasets.get(spec.name);
  } catch (err) {
    if (!(err instanceof NotFoundError)) throw err;
    await client.datasets.create({ name: spec.name, description: spec.description });
    console.log(`${spec.name}: created dataset`);
  }
}

// The list leaves out archived items. A row that comes back is upserted onto
// its old id, so the summary counts it as new.
async function listItems(client: LangfuseAPIClient, datasetName: string): Promise<ExistingItem[]> {
  const items: ExistingItem[] = [];
  for (let page = 1; ; page += 1) {
    const res = await client.datasetItems.list({ datasetName, page, limit: 100 });
    for (const item of res.data) {
      items.push({
        id: item.id,
        status: item.status,
        input: item.input,
        expectedOutput: item.expectedOutput,
        metadata: item.metadata,
      });
    }
    if (page >= res.meta.totalPages) return items;
  }
}

function summary(name: string, plan: SyncPlan): string {
  return `${name}: ${plan.create.length} new, ${plan.update.length} changed, ${plan.archive.length} archived, ${plan.unchanged.length} unchanged`;
}

async function apply(client: LangfuseAPIClient, datasetName: string, plan: SyncPlan) {
  for (const item of [...plan.create, ...plan.update]) {
    await client.datasetItems.create({ datasetName, ...item, status: "ACTIVE" });
  }
  for (const item of plan.archive) {
    await client.datasetItems.create({
      datasetName,
      id: item.id,
      input: item.input,
      expectedOutput: item.expectedOutput,
      metadata: item.metadata,
      status: "ARCHIVED",
    });
  }
}

async function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const envFile = join(here, "..", ".env.local");
  if (existsSync(envFile)) process.loadEnvFile(envFile);

  const specs: DatasetSpec[] = [
    {
      name: GOLDEN_DATASET,
      description: "Nimbus questions with the help article that should answer them. Source: eval/golden.csv.",
      items: goldenItems(loadGolden(join(here, "golden.csv"))),
    },
    {
      name: ESCALATION_DATASET,
      description: "Questions labeled with whether the widget should open a ticket. Source: eval/escalation-labels.csv.",
      items: escalationItems(loadLabels(join(here, "escalation-labels.csv"))),
    },
    {
      name: INTENT_DATASET,
      description: "Customer messages labeled with the sales signal the co-pilot should read: lead, upgrade, churn_risk, or none. Source: eval/intent-labels.csv.",
      items: intentItems(loadIntentLabels(join(here, "intent-labels.csv"))),
    },
  ];

  const { LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY, LANGFUSE_BASE_URL } = process.env;
  const dryRun = process.argv.includes("--dry-run") || !LANGFUSE_PUBLIC_KEY || !LANGFUSE_SECRET_KEY;
  if (dryRun) {
    if (!LANGFUSE_PUBLIC_KEY || !LANGFUSE_SECRET_KEY) {
      console.log("LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY not set; nothing is written.");
    }
    for (const spec of specs) console.log(summary(spec.name, planSync(spec.items, [])));
    return;
  }

  const client = new LangfuseAPIClient({
    environment: LANGFUSE_BASE_URL ?? "https://cloud.langfuse.com",
    username: LANGFUSE_PUBLIC_KEY,
    password: LANGFUSE_SECRET_KEY,
  });

  for (const spec of specs) {
    await ensureDataset(client, spec);
    const plan = planSync(spec.items, await listItems(client, spec.name));
    await apply(client, spec.name, plan);
    console.log(summary(spec.name, plan));
  }
  // Listing items with a `version` at or after this time returns exactly this state.
  console.log(`version ${new Date().toISOString()}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
