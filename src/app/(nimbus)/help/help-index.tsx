"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { Article } from "@/lib/articles";
import { IconSearch } from "@/components/ui";

const CATEGORY_BLURB: Record<string, string> = {
  "Getting started": "Workspaces, projects, first events.",
  Billing: "Seats, event quotas, failed cards.",
  Security: "SSO, Google Workspace, Okta.",
  Developers: "Write keys, read keys, rate limits.",
  Privacy: "Retention windows and exports.",
  Team: "Invites, owners, editors, viewers.",
  Charts: "Funnels, zeros, CSV dumps.",
};

export function HelpIndex({ articles }: { articles: Article[] }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();

  const groups = useMemo(() => {
    const filtered = q
      ? articles.filter(
          (a) =>
            a.title.toLowerCase().includes(q) ||
            a.summary.toLowerCase().includes(q) ||
            a.body.toLowerCase().includes(q) ||
            a.category.toLowerCase().includes(q),
        )
      : articles;
    const map = new Map<string, Article[]>();
    for (const article of filtered) {
      const list = map.get(article.category) ?? [];
      list.push(article);
      map.set(article.category, list);
    }
    return [...map.entries()];
  }, [articles, q]);

  return (
    <main className="mx-auto max-w-4xl px-6 py-16">
      <h1 className="text-center font-serif text-4xl tracking-tight sm:text-5xl">
        How can we help?
      </h1>
      <p className="mx-auto mt-3 max-w-lg text-center text-muted">
        These are the articles the widget searches. Billing, SSO, API keys,
        empty funnels.
      </p>
      <label className="relative mx-auto mt-8 block max-w-xl">
        <span className="sr-only">Search articles</span>
        <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted">
          <IconSearch className="h-[18px] w-[18px]" />
        </span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Describe your issue"
          className="w-full rounded-full border border-line bg-card py-3.5 pl-11 pr-5 text-sm outline-none ring-forest/20 focus:ring-2"
        />
      </label>

      {groups.length === 0 ? (
        <p className="mt-12 text-center text-sm text-muted">
          No articles match &ldquo;{query}&rdquo;.
        </p>
      ) : q ? (
        <ul className="mx-auto mt-10 max-w-xl divide-y divide-line overflow-hidden rounded-xl border border-line bg-card">
          {groups.flatMap(([, list]) => list).map((article) => (
            <li key={article.slug}>
              <Link href={`/help/${article.slug}`} className="block px-5 py-4 hover:bg-paper">
                <p className="text-[11px] uppercase tracking-widest text-copper">
                  {article.category}
                </p>
                <p className="mt-1 font-medium">{article.title}</p>
                <p className="mt-0.5 text-sm text-muted">{article.summary}</p>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-12 grid gap-4 sm:grid-cols-2">
          {groups.map(([category, list]) => (
            <section
              key={category}
              className="rounded-xl border border-line bg-card p-5"
            >
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="font-medium">{category}</h2>
                <span className="text-xs text-muted">
                  {list.length} {list.length === 1 ? "article" : "articles"}
                </span>
              </div>
              <p className="mt-1 text-sm text-muted">
                {CATEGORY_BLURB[category] ?? ""}
              </p>
              <ul className="mt-4 space-y-2">
                {list.map((article) => (
                  <li key={article.slug}>
                    <Link
                      href={`/help/${article.slug}`}
                      className="text-sm hover:text-forest"
                    >
                      {article.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
