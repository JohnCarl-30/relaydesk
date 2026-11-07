import { NextResponse } from "next/server";
import { z } from "zod";
import { allowRequest, clientIp } from "@/lib/rate-limit";

/** Reads a JSON body against a schema; a bad body becomes a 400 with the first problem. */
export async function readBody<T extends z.ZodType>(
  request: Request,
  schema: T,
): Promise<{ data: z.infer<T> } | { error: NextResponse }> {
  let raw: unknown;
  try {
    raw = await request.json();
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

export const unauthorized = () => NextResponse.json({ error: "unauthorized" }, { status: 401 });
export const notFound = () => NextResponse.json({ error: "not found" }, { status: 404 });
export const demoReadOnly = () =>
  NextResponse.json({ error: "the public demo can't change its setup" }, { status: 403 });

export const Password = z.string().min(10, "use at least 10 characters").max(200);
export const PersonName = z.string().trim().min(1, "name is required").max(80);
export const Email = z.string().trim().toLowerCase().pipe(z.email("enter a valid email")).pipe(z.string().max(200));
