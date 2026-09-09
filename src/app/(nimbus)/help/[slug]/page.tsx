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

  const inSection = ARTICLES.filter((a) => a.category === article.category);

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <nav className="flex flex-wrap items-center gap-2 text-sm text-muted">
        <Link href="/help" className="hover:text-ink">
          Help
        </Link>
        <span aria-hidden>/</span>
        <span>{article.category}</span>
        <span aria-hidden>/</span>
        <span className="text-ink">{article.title}</span>
      </nav>

      <div className="mt-10 grid gap-12 lg:grid-cols-[14rem_minmax(0,1fr)]">
        <aside>
          <p className="text-[11px] font-medium uppercase tracking-widest text-muted">
            In this section
          </p>
          <ul className="mt-3 space-y-0.5">
            {inSection.map((item) => (
              <li key={item.slug}>
                <Link
                  href={`/help/${item.slug}`}
                  className={
                    item.slug === article.slug
                      ? "block rounded-md bg-forest/10 px-2.5 py-2 text-sm text-forest"
                      : "block rounded-md px-2.5 py-2 text-sm text-muted hover:bg-card hover:text-ink"
                  }
                >
                  {item.title}
                </Link>
              </li>
            ))}
          </ul>
        </aside>

        <article>
          <p className="text-[11px] font-medium uppercase tracking-widest text-copper">
            {article.category}
          </p>
          <h1 className="mt-2 font-serif text-4xl tracking-tight">{article.title}</h1>
          <p className="mt-3 text-muted">{article.summary}</p>
          <div className="mt-10 space-y-4 text-[1.05rem] leading-7 text-ink">
            {article.body.split("\n\n").map((para) => (
              <p key={para.slice(0, 40)}>{para}</p>
            ))}
          </div>
        </article>
      </div>
    </main>
  );
}
