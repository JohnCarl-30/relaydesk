import Link from "next/link";
import { notFound } from "next/navigation";
import { OpenChatButton } from "@/components/OpenChatButton";
import { IconChevron } from "@/components/ui";
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
  const position = inSection.findIndex((a) => a.slug === article.slug);
  const previous = inSection[position - 1];
  const next = inSection[position + 1];

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 text-sm text-muted">
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
                  aria-current={item.slug === article.slug ? "page" : undefined}
                  className={
                    item.slug === article.slug
                      ? "block rounded-md bg-forest/10 px-2.5 py-2 text-sm text-forest"
                      : "block rounded-md px-2.5 py-2 text-sm text-muted transition-colors hover:bg-card hover:text-ink"
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
          <div className="mt-10 max-w-[34rem] space-y-4 text-[1.05rem] leading-7 text-ink">
            {article.body.split("\n\n").map((para) => (
              <p key={para.slice(0, 40)}>{para}</p>
            ))}
          </div>

          <section className="mt-14 flex max-w-[34rem] flex-col gap-4 rounded-xl bg-forest/5 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-medium">Still stuck?</h2>
              <p className="mt-0.5 text-sm text-muted">
                The chat answers from these articles and opens a ticket when it can&apos;t.
              </p>
            </div>
            <OpenChatButton className="shrink-0 rounded-lg bg-forest px-4 py-2.5 text-sm text-paper transition hover:bg-forest-2 active:scale-[0.98]">
              Chat with support
            </OpenChatButton>
          </section>

          {previous || next ? (
            <nav
              aria-label="More in this section"
              className="mt-8 flex max-w-[34rem] flex-wrap justify-between gap-4 text-sm"
            >
              {previous ? (
                <Link href={`/help/${previous.slug}`} className="group max-w-[45%] text-muted hover:text-ink">
                  <span className="flex items-center gap-1 text-xs">
                    <IconChevron className="h-3 w-3 rotate-180" /> Previous
                  </span>
                  <span className="text-ink group-hover:text-forest">{previous.title}</span>
                </Link>
              ) : (
                <span />
              )}
              {next ? (
                <Link href={`/help/${next.slug}`} className="group ml-auto max-w-[45%] text-right text-muted hover:text-ink">
                  <span className="flex items-center justify-end gap-1 text-xs">
                    Next <IconChevron className="h-3 w-3" />
                  </span>
                  <span className="text-ink group-hover:text-forest">{next.title}</span>
                </Link>
              ) : null}
            </nav>
          ) : null}
        </article>
      </div>
    </main>
  );
}
