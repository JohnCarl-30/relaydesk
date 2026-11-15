/*
 * Caps how fast one visitor can send chat messages, so a script can't run up the
 * model bill. In-process, like the ElevenLabs play counter, which suits one server.
 */

export const CHAT_PER_MINUTE = 20;
const WINDOW_MS = 60_000;
const REMEMBERED = 10_000;
const hits = new Map<string, number[]>();

/** Records a request from `key` and says whether it is still under `limit` per minute. */
export function allowRequest(key: string, limit = CHAT_PER_MINUTE, now = Date.now()): boolean {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  const allowed = recent.length < limit;
  if (allowed) recent.push(now);
  hits.delete(key);
  hits.set(key, recent);
  // Maps iterate in insertion order, so the first key is the visitor seen longest ago.
  if (hits.size > REMEMBERED) hits.delete(hits.keys().next().value!);
  return allowed;
}

/** Model calls the whole server may make in a UTC day, across every business and visitor. */
export const MODEL_CALLS_PER_DAY = 2_000;
// shortcut: counted in this process, so a restart starts the day over; move it to the database if you run more than one server.
let modelDay = "";
let modelCalls = 0;

const utcDay = (now: number) => new Date(now).toISOString().slice(0, 10);

/** Counts one paid model call toward today's budget. */
export function recordModelCall(now = Date.now()) {
  if (utcDay(now) !== modelDay) {
    modelDay = utcDay(now);
    modelCalls = 0;
  }
  modelCalls += 1;
}

/** False once today's model calls reach RELAYDESK_MODEL_CALLS_PER_DAY; answers then come from the articles alone. */
export function modelBudgetLeft(now = Date.now()): boolean {
  const limit = Number(process.env.RELAYDESK_MODEL_CALLS_PER_DAY) || MODEL_CALLS_PER_DAY;
  return utcDay(now) !== modelDay || modelCalls < limit;
}

/**
 * The caller's IP. The last X-Forwarded-For entry is the one our proxy added; earlier ones are the client's to forge.
 * shortcut: without a proxy in front the whole header is client-controlled, so deploy behind one (Dokploy's Traefik does this).
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",").map((s) => s.trim()).filter(Boolean);
  return forwarded?.at(-1) ?? headers.get("x-real-ip")?.trim() ?? "unknown";
}
