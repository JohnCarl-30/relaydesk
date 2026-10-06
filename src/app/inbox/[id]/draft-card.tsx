"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { helpHrefForTitle } from "@/lib/articles";
import type { DraftKind } from "@/lib/models";

export type DraftView = {
  id: string;
  kind: DraftKind;
  body: string;
  rationale: string;
  model: string;
  related: string[];
};

const REJECT_REASONS = [
  { value: "wrong", label: "Wrong facts" },
  { value: "not_helpful", label: "Not helpful" },
  { value: "tone", label: "Tone" },
  { value: "other", label: "Other" },
];

const OUTCOME_NOTE: Record<string, string> = {
  disabled: "AI drafts are off.",
  rate_limited: "Draft limit reached for this ticket today.",
  error: "Drafting failed. Try again or reply yourself.",
};

export function DraftCard({
  ticketId,
  draft,
  needsHumanReason,
  enabled,
}: {
  ticketId: string;
  draft: DraftView | null;
  needsHumanReason: string | null;
  enabled: boolean;
}) {
  const router = useRouter();
  const [text, setText] = useState(draft?.body ?? "");
  const [reason, setReason] = useState("wrong");
  const [pending, setPending] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function call(url: string, payload?: object) {
    setPending(true);
    setNote(null);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload ?? {}),
    });
    setPending(false);
    const data = (await res.json().catch(() => ({}))) as { outcome?: string; error?: string };
    if (!res.ok) {
      setNote(data.error ?? "Something went wrong.");
      return;
    }
    if (data.outcome && OUTCOME_NOTE[data.outcome]) setNote(OUTCOME_NOTE[data.outcome]);
    router.refresh();
  }

  const regenerate = () => void call(`/api/tickets/${ticketId}/draft`);

  if (!draft) {
    return (
      <section aria-label="Suggested reply" className="border-t border-line bg-forest/5 px-4 py-3 text-sm">
        <div className="flex items-center justify-between gap-3">
          <p className="text-muted">
            {enabled ? "No suggested reply yet." : "AI drafts are off."}
            {needsHumanReason ? <span className="ml-1 text-ink">{needsHumanReason}</span> : null}
          </p>
          {enabled ? (
            <button
              type="button"
              onClick={regenerate}
              disabled={pending}
              className="shrink-0 text-xs text-forest transition-colors hover:text-forest-2 disabled:opacity-50"
            >
              {pending ? "Drafting…" : "Draft a reply"}
            </button>
          ) : null}
        </div>
        {note ? <p role="status" className="mt-1 text-xs text-copper">{note}</p> : null}
      </section>
    );
  }

  return (
    <section aria-label="Suggested reply" className="border-t border-line bg-forest/5 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-xs">
          <span className="font-medium">Suggested reply</span>
          <span className="rounded bg-forest/10 px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-forest">
            {draft.kind === "answer" ? "Answer" : "Holding reply"}
          </span>
          <span className="text-muted">{draft.model}</span>
        </p>
        <button
          type="button"
          onClick={regenerate}
          disabled={pending}
          className="text-xs text-muted transition-colors hover:text-ink disabled:opacity-50"
        >
          Regenerate
        </button>
      </div>
      <p className="mt-1 text-xs text-muted">{draft.rationale}</p>
      <textarea
        aria-label="Suggested reply text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        className="mt-2 w-full resize-none rounded-lg border border-line bg-card px-3 py-2 text-sm outline-none ring-forest/20 focus:ring-2"
      />
      {draft.related.length ? (
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted">
          Related:
          {draft.related.map((title) => (
            <Link key={title} href={helpHrefForTitle(title)} className="text-ink underline-offset-2 hover:text-forest hover:underline">
              {title}
            </Link>
          ))}
        </p>
      ) : null}
      {note ? <p role="status" className="mt-1 text-xs text-copper">{note}</p> : null}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <label className="sr-only" htmlFor={`reject-${draft.id}`}>Reject reason</label>
          <select
            id={`reject-${draft.id}`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="rounded-md border border-line bg-paper px-2 py-1 text-xs"
          >
            {REJECT_REASONS.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
          <button
            type="button"
            disabled={pending}
            onClick={() => void call(`/api/tickets/${ticketId}/draft/${draft.id}`, { action: "reject", reason })}
            className="rounded-md border border-line px-2.5 py-1 text-xs transition hover:bg-paper active:scale-[0.98] disabled:opacity-50"
          >
            Reject
          </button>
        </div>
        <button
          type="button"
          disabled={pending || !text.trim()}
          onClick={() => void call(`/api/tickets/${ticketId}/draft/${draft.id}`, { action: "send", body: text })}
          className="rounded-lg bg-forest px-3.5 py-1.5 text-sm text-paper transition hover:bg-forest-2 active:scale-[0.98] disabled:opacity-50"
        >
          {text.trim() === draft.body ? "Send" : "Send edited"}
        </button>
      </div>
    </section>
  );
}
