import { NextResponse } from "next/server";
import { z } from "zod";
import { readBody, unauthorized } from "@/lib/api";
import { parseArticles } from "@/lib/article-import";
import { currentStaff } from "@/lib/auth";
import { replaceArticles, saveArticles } from "@/lib/db";

const Import = z.object({
  format: z.enum(["markdown", "json"]),
  text: z.string().min(1, "paste something to import").max(500_000),
  /** "add" keeps existing articles and updates ones with the same link; "replace" starts over. */
  mode: z.enum(["add", "replace"]).default("add"),
});

export async function POST(request: Request) {
  const staff = await currentStaff();
  if (!staff) return unauthorized();
  const body = await readBody(request, Import);
  if ("error" in body) return body.error;
  let articles;
  try {
    articles = parseArticles(body.data.format, body.data.text);
  } catch (err) {
    const message = err instanceof z.ZodError ? err.issues[0].message : (err as Error).message;
    return NextResponse.json({ error: message }, { status: 400 });
  }
  if (body.data.mode === "replace") replaceArticles(staff.business_id, articles);
  else saveArticles(staff.business_id, articles);
  return NextResponse.json({ imported: articles.length });
}
