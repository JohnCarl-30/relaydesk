import Link from "next/link";
import { ARTICLES } from "@/lib/articles";

export default function HelpIndexPage() {
  const groups = new Map<string, typeof ARTICLES>();
  for (const article of ARTICLES) {
    const list = groups.get(article.category) ?? [];
    list.push(article);
    groups.set(article.category, list);
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-16">
      <h1 className="font-serif text-4xl tracking-tight">Nimbus help center</h1>
      <p className="mt-3 max-w-xl text-muted">
        This is the golden corpus the widget searches. Ask about billing, SSO,
        API keys, or funnels showing zeros.
      </p>
      <div className="mt-12 grid gap-12 sm:grid-cols-2">
        {[...groups.entries()].map(([category, articles]) => (
          <section key={category}>
            <h2 className="text-xs uppercase tracking-widest text-copper">{category}</h2>
            <ul className="mt-3 space-y-3">
              {articles.map((article) => (
                <li key={article.slug}>
                  <Link href={`/help/${article.slug}`} className="group block">
                    <p className="font-medium group-hover:text-forest">{article.title}</p>
                    <p className="text-sm text-muted">{article.summary}</p>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </main>
  );
}
