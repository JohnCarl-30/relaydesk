/**
 * Latency and cost per answer for the Langfuse experiments one run-experiments.ts call recorded.
 *
 *   npx --yes tsx eval/run-costs.ts gpt-4o-mini 2026-11-05T06:00:00Z   # run name, and a time before the run started
 *
 * Latency is the widget's own spans per item (support.answer, or copilot.intent for
 * intent), not the judge or Langfuse's upload. Cost is the sum of each item's model
 * calls as Langfuse priced them from model name and tokens. The judge records no
 * spans, so it isn't counted.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

type Observation = {
  traceId: string;
  parentObservationId: string | null;
  type: string;
  name: string;
  latency: number | null;
  model?: string | null;
  totalCost?: number | null;
  metadata?: Record<string, unknown> | null;
};
type Experiment = { id: string; name: string; description: string; startTime: string; endTime: string; itemCount: number };

const here = dirname(fileURLToPath(import.meta.url));
const envFile = join(here, "..", ".env.local");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const base = (process.env.LANGFUSE_BASE_URL ?? "https://cloud.langfuse.com").replace(/\/$/, "");
const auth = Buffer.from(`${process.env.LANGFUSE_PUBLIC_KEY}:${process.env.LANGFUSE_SECRET_KEY}`).toString("base64");

async function get<T>(path: string, params: Record<string, string>): Promise<T> {
  const res = await fetch(`${base}${path}?${new URLSearchParams(params)}`, { headers: { authorization: `Basic ${auth}` } });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const p95 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.round(0.95 * (xs.length - 1))];

async function main() {
  const [runName, since] = process.argv.slice(2);
  if (!runName || !since) throw new Error("usage: run-costs.ts <run-name> <ISO time before the run>");
  if (!process.env.LANGFUSE_PUBLIC_KEY || !process.env.LANGFUSE_SECRET_KEY) throw new Error("needs LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY");

  const { data } = await get<{ data: Experiment[] }>("/api/public/experiments", { fromStartTime: since, limit: "100" });
  const runs = data.filter((e) => e.name === runName).sort((a, b) => a.startTime.localeCompare(b.startTime));
  if (!runs.length) throw new Error(`no experiment run named ${runName} since ${since}`);

  for (const run of runs) {
    const observations: Observation[] = [];
    let cursor: string | undefined;
    do {
      const page = await get<{ data: Observation[]; meta?: { cursor?: string } }>("/api/public/v2/observations", {
        fromStartTime: run.startTime,
        toStartTime: run.endTime,
        limit: "1000",
        fields: "core,basic,usage,model,metadata",
        ...(cursor ? { cursor } : {}),
      });
      observations.push(...page.data);
      cursor = page.data.length ? page.meta?.cursor : undefined;
    } while (cursor);

    const byTrace = new Map<string, Observation[]>();
    for (const o of observations) {
      if (o.metadata?.["attributes.langfuse.experiment.id"] !== run.id) continue;
      byTrace.set(o.traceId, [...(byTrace.get(o.traceId) ?? []), o]);
    }
    if (byTrace.size !== run.itemCount) throw new Error(`${run.id}: found ${byTrace.size} items, expected ${run.itemCount}`);

    const latency: number[] = [];
    const cost: number[] = [];
    const models = new Set<string>();
    for (const items of byTrace.values()) {
      const root = items[0].metadata?.["attributes.langfuse.experiment.item.root_observation_id"];
      latency.push(items.filter((o) => o.parentObservationId === root).reduce((s, o) => s + (o.latency ?? 0), 0));
      const calls = items.filter((o) => o.type === "GENERATION");
      cost.push(calls.reduce((s, o) => s + (o.totalCost ?? 0), 0));
      for (const o of calls) if (o.model) models.add(o.model);
    }
    console.log(
      `${run.description.split(/[.:]/)[0]} (${run.itemCount} items, ${run.id}): ` +
        `latency mean ${mean(latency).toFixed(2)}s, p95 ${p95(latency).toFixed(2)}s; ` +
        `cost per answer $${mean(cost).toFixed(6)}, total $${cost.reduce((a, b) => a + b, 0).toFixed(4)}; ` +
        `models ${[...models].join(", ") || "none"}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
