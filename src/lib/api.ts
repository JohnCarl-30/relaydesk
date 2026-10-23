import { NextResponse } from "next/server";
import { z } from "zod";

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

export const unauthorized = () => NextResponse.json({ error: "unauthorized" }, { status: 401 });
export const notFound = () => NextResponse.json({ error: "not found" }, { status: 404 });

export const Password = z.string().min(10, "use at least 10 characters").max(200);
export const PersonName = z.string().trim().min(1, "name is required").max(80);
export const Email = z.string().trim().toLowerCase().pipe(z.email("enter a valid email")).pipe(z.string().max(200));
