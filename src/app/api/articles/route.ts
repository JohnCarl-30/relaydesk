import { NextResponse } from "next/server";
import { readBody, unauthorized } from "@/lib/api";
import { ArticleInput, toArticle } from "@/lib/article-import";
import { currentStaff } from "@/lib/auth";
import { listArticles, saveArticles } from "@/lib/db";

/** Adds one article. A slug already in use is refused rather than overwritten. */
export async function POST(request: Request) {
  const staff = await currentStaff();
  if (!staff) return unauthorized();
  const body = await readBody(request, ArticleInput);
  if ("error" in body) return body.error;
  const article = toArticle(body.data);
  if (listArticles(staff.business_id).some((a) => a.slug === article.slug)) {
    return NextResponse.json(
      { error: `An article already uses the link "${article.slug}". Change the title or link.` },
      { status: 409 },
    );
  }
  saveArticles(staff.business_id, [article]);
  return NextResponse.json({ article });
}
