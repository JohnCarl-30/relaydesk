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

/**
 * The caller's IP. The last X-Forwarded-For entry is the one our proxy added; earlier ones are the client's to forge.
 * shortcut: without a proxy in front the whole header is client-controlled, so deploy behind one (Dokploy's Traefik does this).
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",").map((s) => s.trim()).filter(Boolean);
  return forwarded?.at(-1) ?? headers.get("x-real-ip")?.trim() ?? "unknown";
}
