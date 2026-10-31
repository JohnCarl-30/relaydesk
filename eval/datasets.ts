import { createHash } from "node:crypto";
import type { GoldenRow } from "./golden";
import type { IntentLabelRow, LabelRow } from "./labels";

export const GOLDEN_DATASET = "relaydesk-golden";
export const ESCALATION_DATASET = "relaydesk-escalation";
export const INTENT_DATASET = "relaydesk-intent";

/** One row of a CSV, shaped the way it is stored as a Langfuse dataset item. */
export type DesiredItem = {
  id: string;
  input: unknown;
  expectedOutput: unknown;
  metadata: unknown;
};

/** The parts of a Langfuse dataset item the sync compares. */
export type ExistingItem = DesiredItem & { status: "ACTIVE" | "ARCHIVED" };

export type SyncPlan = {
  create: DesiredItem[];
  update: DesiredItem[];
  unchanged: DesiredItem[];
  archive: ExistingItem[];
};

/**
 * Item ids are project-wide in Langfuse, so they carry the dataset name.
 * Hashing the question keeps the id stable when rows are reordered. Editing a
 * question gives a new id, and the old item is archived.
 */
export function itemId(dataset: string, question: string): string {
  return `${dataset}-${createHash("sha256").update(question).digest("hex").slice(0, 12)}`;
}

function assertUnique(items: DesiredItem[], dataset: string): DesiredItem[] {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) throw new Error(`${dataset}: duplicate question ${JSON.stringify(item.input)}`);
    seen.add(item.id);
  }
  return items;
}

/** Out-of-corpus rows have no expected slug; they are stored as `slug: null`. */
export function goldenItems(rows: GoldenRow[]): DesiredItem[] {
  return assertUnique(
    rows.map((row) => ({
      id: itemId(GOLDEN_DATASET, row.question),
      input: { question: row.question },
      expectedOutput: { slug: row.slug || null, answer: row.groundTruth },
      metadata: { source: "eval/golden.csv" },
    })),
    GOLDEN_DATASET,
  );
}

export function escalationItems(rows: LabelRow[]): DesiredItem[] {
  return assertUnique(
    rows.map((row) => ({
      id: itemId(ESCALATION_DATASET, row.question),
      input: { question: row.question },
      expectedOutput: { shouldEscalate: row.shouldEscalate },
      metadata: { source: "eval/escalation-labels.csv", why: row.why },
    })),
    ESCALATION_DATASET,
  );
}

export function intentItems(rows: IntentLabelRow[]): DesiredItem[] {
  return assertUnique(
    rows.map((row) => ({
      id: itemId(INTENT_DATASET, row.question),
      input: { question: row.question },
      expectedOutput: { intent: row.intent },
      metadata: { source: "eval/intent-labels.csv", why: row.why },
    })),
    INTENT_DATASET,
  );
}

/** JSON with sorted keys, so key order from the API doesn't count as a change. */
export function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );
}

function sameContent(a: DesiredItem, b: DesiredItem): boolean {
  return (
    stableJson(a.input) === stableJson(b.input) &&
    stableJson(a.expectedOutput) === stableJson(b.expectedOutput) &&
    stableJson(a.metadata) === stableJson(b.metadata)
  );
}

/**
 * Compares the CSV with what Langfuse holds. Only changed items are written,
 * so a rerun with no CSV edits writes nothing and adds no dataset version.
 */
export function planSync(desired: DesiredItem[], existing: ExistingItem[]): SyncPlan {
  const byId = new Map(existing.map((item) => [item.id, item]));
  const wanted = new Set(desired.map((item) => item.id));
  const plan: SyncPlan = { create: [], update: [], unchanged: [], archive: [] };
  for (const item of desired) {
    const current = byId.get(item.id);
    if (!current) plan.create.push(item);
    else if (current.status !== "ACTIVE" || !sameContent(item, current)) plan.update.push(item);
    else plan.unchanged.push(item);
  }
  for (const item of existing) {
    if (!wanted.has(item.id) && item.status === "ACTIVE") plan.archive.push(item);
  }
  return plan;
}
