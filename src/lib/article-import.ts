import { z } from "zod";
import type { Article } from "./articles";

/*
 * Turning what a business already has into help articles: one article typed in
 * a form, a JSON array, or Markdown where each "## " heading is an article.
 */

export const MAX_ARTICLES = 200;
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;

export const ArticleInput = z.object({
  slug: z.string().trim().regex(SLUG, "slug: lowercase letters, digits, and dashes").optional(),
  title: z.string().trim().min(1, "title is required").max(200),
  category: z.string().trim().max(60).optional(),
  summary: z.string().trim().max(300).optional(),
  body: z.string().trim().min(1, "body is required").max(20_000),
});

export type ArticleInput = z.infer<typeof ArticleInput>;

export function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60)
      .replace(/-+$/, "") || "article"
  );
}

/** The first sentence, so a pasted FAQ still gets a one-line summary. */
function firstSentence(body: string): string {
  const flat = body.replace(/\s+/g, " ").trim();
  const sentence = flat.match(/^.+?[.!?](?=\s|$)/)?.[0] ?? flat;
  return sentence.length > 160 ? `${sentence.slice(0, 157)}…` : sentence;
}

export function toArticle(input: ArticleInput): Article {
  const parsed = ArticleInput.parse(input);
  return {
    slug: parsed.slug || slugify(parsed.title),
    title: parsed.title,
    category: parsed.category || "General",
    summary: parsed.summary || firstSentence(parsed.body),
    body: parsed.body.replace(/\r\n/g, "\n"),
  };
}

function checkBatch(articles: Article[]): Article[] {
  if (articles.length === 0) throw new Error("No articles found.");
  if (articles.length > MAX_ARTICLES) throw new Error(`At most ${MAX_ARTICLES} articles at once.`);
  const seen = new Set<string>();
  for (const { slug, title } of articles) {
    if (seen.has(slug)) throw new Error(`Two articles share the link "${slug}" ("${title}"). Rename one.`);
    seen.add(slug);
  }
  return articles;
}

/** A JSON array of articles: title and body required; slug, category, summary optional. */
export function parseJsonArticles(text: string): Article[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("That isn't valid JSON.");
  }
  const parsed = z.array(ArticleInput).safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`Article ${Number(issue.path[0] ?? 0) + 1}: ${issue.message}`);
  }
  return checkBatch(parsed.data.map(toArticle));
}

/**
 * Markdown: "# Category" starts a section, "## Title" starts an article, and
 * everything up to the next heading is its body.
 *
 *   # Orders
 *   ## Where do you deliver?
 *   Metro Manila in 1 to 2 days.
 */
export function parseMarkdownArticles(text: string): Article[] {
  const articles: Article[] = [];
  let category = "General";
  let current: { title: string; lines: string[]; category: string } | null = null;
  const flush = () => {
    if (!current) return;
    const body = current.lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    if (!body) throw new Error(`"${current.title}" has no text under it.`);
    articles.push(toArticle({ title: current.title, category: current.category, body }));
    current = null;
  };
  for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
    const heading = line.match(/^(#{1,2})\s+(.+?)\s*#*\s*$/);
    if (heading?.[1] === "#") {
      flush();
      category = heading[2];
    } else if (heading?.[1] === "##") {
      flush();
      current = { title: heading[2], lines: [], category };
    } else if (current) {
      current.lines.push(line);
    } else if (line.trim()) {
      throw new Error('Start each article with a "## " heading line.');
    }
  }
  flush();
  return checkBatch(articles);
}

export function parseArticles(format: "markdown" | "json", text: string): Article[] {
  return format === "json" ? parseJsonArticles(text) : parseMarkdownArticles(text);
}
