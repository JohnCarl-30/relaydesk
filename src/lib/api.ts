import { NextResponse } from "next/server";
import { z } from "zod";
import { allowRequest, CHAT_PER_MINUTE, clientIp } from "@/lib/rate-limit";

const MAX_BODY_BYTES = 1_000_000;

/** The body as text, or null once it passes `maxBytes`. Counts as it reads: a chunked upload has no Content-Length to check first. */
async function readText(request: Request, maxBytes: number): Promise<string | null> {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return text + decoder.decode();
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel();
      return null;
    }
    text += decoder.decode(value, { stream: true });
  }
}

/**
 * Reads a JSON body against a schema; a bad body becomes a 400 with the first problem.
 * Route handlers have no size limit of their own, so a body over `maxBytes` is refused with a 413.
 */
export async function readBody<T extends z.ZodType>(
  request: Request,
  schema: T,
  maxBytes = MAX_BODY_BYTES,
): Promise<{ data: z.infer<T> } | { error: NextResponse }> {
  const text = await readText(request, maxBytes);
  if (text === null) return { error: NextResponse.json({ error: "that's too much to send at once" }, { status: 413 }) };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { error: NextResponse.json({ error: "body must be JSON" }, { status: 400 }) };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue.path.length ? `${issue.path.join(".")}: ` : "";
    return { error: NextResponse.json({ error: `${where}${issue.message}` }, { status: 400 }) };
  }
  return { data: parsed.data };
}

const AUTH_PER_MINUTE = 10;

/**
 * Login, sign-up and invite acceptance each run scrypt, which blocks the server for a moment,
 * so together they get a small per-visitor budget. Null when this request is still within it.
 */
export function authRateLimited(request: Request): NextResponse | null {
  const limit = Number(process.env.RELAYDESK_AUTH_PER_MINUTE) || AUTH_PER_MINUTE;
  if (allowRequest(`auth:${clientIp(request.headers)}`, limit)) return null;
  return NextResponse.json(
    { error: "Too many tries. Wait a minute and try again." },
    { status: 429, headers: { "Retry-After": "60" } },
  );
}

/**
 * The widget's budget, kept per route so saving an email doesn't use up chat messages.
 * Null when this request is still within it.
 */
export function chatRateLimited(request: Request, route = ""): NextResponse | null {
  const limit = Number(process.env.RELAYDESK_CHAT_PER_MINUTE) || CHAT_PER_MINUTE;
  if (allowRequest(`${route}${clientIp(request.headers)}`, limit)) return null;
  return NextResponse.json(
    { error: "You're sending messages too fast. Wait a minute and try again." },
    { status: 429, headers: { "Retry-After": "60" } },
  );
}

export const unauthorized =() => NextResponse.json({ error: "unauthorized" }, { status: 401 });
export const notFound = () => NextResponse.json({ error: "not found" }, { status: 404 });
export const demoReadOnly = () =>
  NextResponse.json({ error: "the public demo can't change its setup" }, { status: 403 });

export const Password = z.string().min(10, "use at least 10 characters").max(200);
export const PersonName = z.string().trim().min(1, "name is required").max(80);
export const Email = z.string().trim().toLowerCase().pipe(z.email("enter a valid email")).pipe(z.string().max(200));
