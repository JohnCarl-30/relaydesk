import { NextResponse } from "next/server";
import { notFound, readBody, unauthorized } from "@/lib/api";
import { ArticleInput, toArticle } from "@/lib/article-import";
import { currentStaff } from "@/lib/auth";
import { deleteArticle, listArticles, saveArticles } from "@/lib/db";

type Context = { params: Promise<{ slug: string }> };

export async function PUT(request: Request, context: Context) {
  const staff = await currentStaff();
  if (!staff) return unauthorized();
  const { slug } = await context.params;
  const body = await readBody(request, ArticleInput);
  if ("error" in body) return body.error;
  const existing = listArticles(staff.business_id);
  if (!existing.some((a) => a.slug === slug)) return notFound();
  const article = toArticle({ ...body.data, slug: body.data.slug || slug });
  if (article.slug !== slug && existing.some((a) => a.slug === article.slug)) {
    return NextResponse.json(
      { error: `An article already uses the link "${article.slug}".` },
      { status: 409 },
    );
  }
  saveArticles(staff.business_id, [article], { replacing: slug });
  return NextResponse.json({ article });
}

export async function DELETE(_request: Request, context: Context) {
  const staff = await currentStaff();
  if (!staff) return unauthorized();
  const { slug } = await context.params;
  if (!deleteArticle(staff.business_id, slug)) return notFound();
  return NextResponse.json({ ok: true });
}
