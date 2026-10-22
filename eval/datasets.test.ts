import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  GOLDEN_DATASET,
  escalationItems,
  goldenItems,
  itemId,
  planSync,
  type ExistingItem,
} from "./datasets";
import { loadGolden } from "./golden";
import { loadLabels } from "./labels";

const here = dirname(fileURLToPath(import.meta.url));
const golden = goldenItems(loadGolden(join(here, "golden.csv")));
const escalation = escalationItems(loadLabels(join(here, "escalation-labels.csv")));

const synced = (items: typeof golden): ExistingItem[] =>
  items.map((item) => ({ ...structuredClone(item), status: "ACTIVE" }));

describe("dataset items", () => {
  it("turns every CSV row into one item with a unique id", () => {
    assert.equal(golden.length, 70);
    assert.equal(escalation.length, 23);
    assert.equal(new Set([...golden, ...escalation].map((item) => item.id)).size, 93);
  });

  it("keeps the expected slug, and null for out-of-corpus rows", () => {
    const slugs = golden.map((item) => (item.expectedOutput as { slug: string | null }).slug);
    assert.equal(slugs.filter((slug) => slug !== null).length, 60);
    const sso = golden.find(
      (item) => (item.input as { question: string }).question === "Is JIT provisioning on by default?",
    );
    assert.deepEqual((sso?.expectedOutput as { slug: string }).slug, "sso");
  });

  it("keeps the escalation label and the reason", () => {
    const salesforce = escalation.find(
      (item) => (item.input as { question: string }).question === "How do I connect Nimbus to Salesforce?",
    );
    assert.deepEqual(salesforce?.expectedOutput, { shouldEscalate: true });
    assert.equal((salesforce?.metadata as { why: string }).why, "not in the help center");
  });

  it("derives the id from the dataset and the question, not the row number", () => {
    assert.equal(itemId(GOLDEN_DATASET, "a"), itemId(GOLDEN_DATASET, "a"));
    assert.notEqual(itemId(GOLDEN_DATASET, "a"), itemId("relaydesk-escalation", "a"));
    assert.deepEqual(goldenItems(loadGolden(join(here, "golden.csv")).reverse()).reverse(), golden);
  });
});

describe("planSync", () => {
  it("creates everything on the first run", () => {
    const plan = planSync(golden, []);
    assert.equal(plan.create.length, 70);
    assert.equal(plan.update.length + plan.archive.length + plan.unchanged.length, 0);
  });

  it("writes nothing on a rerun, even when the API reorders keys", () => {
    const existing = synced(golden).map((item) => ({
      ...item,
      expectedOutput: Object.fromEntries(Object.entries(item.expectedOutput as object).reverse()),
    }));
    const plan = planSync(golden, existing);
    assert.equal(plan.unchanged.length, 70);
    assert.equal(plan.create.length + plan.update.length + plan.archive.length, 0);
  });

  it("updates an edited answer and archives a removed question", () => {
    const existing = synced(golden);
    const edited = golden.slice(1).map((item, i) =>
      i === 0 ? { ...item, expectedOutput: { slug: "workspaces", answer: "changed" } } : item,
    );
    const plan = planSync(edited, existing);
    assert.deepEqual(plan.update.map((item) => item.id), [golden[1].id]);
    assert.deepEqual(plan.archive.map((item) => item.id), [golden[0].id]);
    assert.equal(plan.unchanged.length, 68);
  });

  it("reactivates an archived item that comes back", () => {
    const existing = synced(golden).map((item, i) => (i === 0 ? { ...item, status: "ARCHIVED" as const } : item));
    const plan = planSync(golden, existing);
    assert.deepEqual(plan.update.map((item) => item.id), [golden[0].id]);
    assert.equal(planSync(golden.slice(1), existing).archive.length, 0);
  });
});
