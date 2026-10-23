"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Shared pieces for the inbox's Setup, Articles, and Team pages. */

export function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section aria-label={title} className="border-t border-line py-8 first:border-t-0 first:pt-0">
      <h2 className="font-medium">{title}</h2>
      {description ? <p className="mt-1 max-w-xl text-sm text-muted">{description}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export const inputClass =
  "w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm outline-none ring-forest/20 focus:ring-2";
export const primaryButton =
  "rounded-lg bg-forest px-3.5 py-2 text-sm text-paper transition hover:bg-forest-2 active:scale-[0.98] disabled:opacity-50";
export const secondaryButton =
  "rounded-lg border border-line px-3.5 py-2 text-sm transition hover:bg-card active:scale-[0.98] disabled:opacity-50";

export function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-stretch gap-2">
      <input readOnly aria-label={label} value={value} className={`${inputClass} font-mono text-xs`} onFocus={(e) => e.target.select()} />
      <button
        type="button"
        className={`${secondaryButton} shrink-0`}
        onClick={async () => {
          await navigator.clipboard?.writeText(value).catch(() => undefined);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

/**
 * fetch + JSON for the admin forms. Returns the parsed body, or throws the
 * server's error message, and refreshes server components after a success.
 */
export function useApi() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function call<T>(url: string, method: string, body?: unknown): Promise<T | null> {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method,
        headers: body === undefined ? undefined : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as T & { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
        return null;
      }
      router.refresh();
      return data;
    } finally {
      setPending(false);
    }
  }
  return { call, pending, error, setError };
}

export function ErrorLine({ error }: { error: string | null }) {
  return error ? (
    <p role="alert" className="mt-2 text-sm text-copper">
      {error}
    </p>
  ) : null;
}
