import Link from "next/link";
import { notFound } from "next/navigation";
import { getArticle, ARTICLES } from "@/lib/articles";

export function generateStaticParams() {
  return ARTICLES.map((article) => ({ slug: article.slug }));
}

export default async function HelpArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const article = getArticle(slug);
  if (!article) notFound();

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <Link href="/help" className="text-sm text-muted hover:text-ink">
        ← Help center
      </Link>
      <p className="mt-8 text-xs uppercase tracking-widest text-copper">{article.category}</p>
      <h1 className="mt-2 font-serif text-4xl tracking-tight">{article.title}</h1>
      <p className="mt-3 text-muted">{article.summary}</p>
      <div className="mt-10 space-y-4 text-[1.05rem] leading-7 text-ink">
        {article.body.split("\n\n").map((para) => (
          <p key={para.slice(0, 40)}>{para}</p>
        ))}
      </div>
    </main>
  );
}
