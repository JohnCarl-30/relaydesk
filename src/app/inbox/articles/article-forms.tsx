"use client";

import { useState } from "react";
import {
  ErrorLine,
  inputClass,
  primaryButton,
  secondaryButton,
  useApi,
} from "@/components/admin";
import type { Article } from "@/lib/articles";

export function ArticleList({ articles }: { articles: Article[] }) {
  const [editing, setEditing] = useState<string | null>(null);
  const { call, pending, error } = useApi();
  if (articles.length === 0) {
    return <p className="text-sm text-muted">No articles yet. Write one below or import an FAQ.</p>;
  }
  return (
    <>
      <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-card">
        {articles.map((article) => (
          <li key={article.slug} className="px-4 py-3">
            {editing === article.slug ? (
              <ArticleEditor article={article} onDone={() => setEditing(null)} />
            ) : (
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-[11px] uppercase tracking-widest text-copper">{article.category}</p>
                  <p className="mt-0.5 font-medium">{article.title}</p>
                  <p className="mt-0.5 truncate text-sm text-muted">{article.summary}</p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button type="button" className={secondaryButton} onClick={() => setEditing(article.slug)}>
                    Edit
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    aria-label={`Delete ${article.title}`}
                    className={secondaryButton}
                    onClick={() => void call(`/api/articles/${article.slug}`, "DELETE")}
                  >
                    Delete
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
      <ErrorLine error={error} />
    </>
  );
}

/** New article, or edits to `article` when given. */
export function ArticleEditor({ article, onDone }: { article?: Article; onDone?: () => void }) {
  const [title, setTitle] = useState(article?.title ?? "");
  const [category, setCategory] = useState(article?.category ?? "");
  const [body, setBody] = useState(article?.body ?? "");
  const { call, pending, error } = useApi();

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const payload = { title, category, body, ...(article ? { slug: article.slug } : {}) };
    const saved = article
      ? await call(`/api/articles/${article.slug}`, "PUT", payload)
      : await call("/api/articles", "POST", payload);
    if (!saved) return;
    if (!article) {
      setTitle("");
      setCategory("");
      setBody("");
    }
    onDone?.();
  }

  return (
    <form onSubmit={save} className="space-y-3">
      <label className="block text-sm">
        <span className="text-muted">Question or title</span>
        <input required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Where do you deliver?" className={`${inputClass} mt-1`} />
      </label>
      <label className="block text-sm">
        <span className="text-muted">Category (optional)</span>
        <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Orders" className={`${inputClass} mt-1`} />
      </label>
      <label className="block text-sm">
        <span className="text-muted">Answer</span>
        <textarea required rows={6} value={body} onChange={(e) => setBody(e.target.value)} className={`${inputClass} mt-1`} />
      </label>
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className={primaryButton}>
          {article ? "Save" : "Add article"}
        </button>
        {onDone ? (
          <button type="button" className={secondaryButton} onClick={onDone}>
            Cancel
          </button>
        ) : null}
      </div>
      <ErrorLine error={error} />
    </form>
  );
}

const EXAMPLE = `# Orders
## Where do you deliver?
We deliver within Metro Manila in 1 to 2 days.

## Can I change my order?
Message us within an hour of ordering.`;

export function ImportArticles() {
  const [format, setFormat] = useState<"markdown" | "json">("markdown");
  const [mode, setMode] = useState<"add" | "replace">("add");
  const [text, setText] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const { call, pending, error } = useApi();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setDone(null);
    const result = await call<{ imported: number }>("/api/articles/import", "POST", { format, mode, text });
    if (result) {
      setDone(`Imported ${result.imported} ${result.imported === 1 ? "article" : "articles"}.`);
      setText("");
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="flex flex-wrap gap-3 text-sm">
        <label className="flex items-center gap-2">
          <span className="text-muted">Format</span>
          <select value={format} onChange={(e) => setFormat(e.target.value as "markdown" | "json")} className="rounded-md border border-line bg-paper px-2 py-1">
            <option value="markdown">Markdown</option>
            <option value="json">JSON</option>
          </select>
        </label>
        <label className="flex items-center gap-2">
          <span className="text-muted">Existing articles</span>
          <select value={mode} onChange={(e) => setMode(e.target.value as "add" | "replace")} className="rounded-md border border-line bg-paper px-2 py-1">
            <option value="add">Keep, update matching titles</option>
            <option value="replace">Replace all</option>
          </select>
        </label>
      </div>
      <textarea
        aria-label="Articles to import"
        rows={10}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={format === "markdown" ? EXAMPLE : '[{ "title": "Where do you deliver?", "body": "..." }]'}
        className={`${inputClass} font-mono text-xs`}
      />
      <button type="submit" disabled={pending || !text.trim()} className={primaryButton}>
        Import
      </button>
      {done ? <p role="status" className="text-sm text-forest">{done}</p> : null}
      <ErrorLine error={error} />
    </form>
  );
}
