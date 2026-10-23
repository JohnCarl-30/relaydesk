"use client";

import { useState } from "react";
import { ErrorLine, inputClass, primaryButton } from "@/components/admin";

type Turn = { role: "visitor" | "assistant"; body: string; sources?: string[]; escalated?: boolean };

export function PreviewChat({ businessName, disabled }: { businessName: string; disabled: boolean }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    const message = input.trim();
    if (!message || pending) return;
    setInput("");
    setError(null);
    setPending(true);
    const history = turns.map(({ role, body }) => ({ role, body }));
    setTurns((prev) => [...prev, { role: "visitor", body: message }]);
    try {
      const res = await fetch("/api/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, history }),
      });
      const data = (await res.json()) as {
        reply?: string;
        citations?: { title: string }[];
        escalated?: boolean;
        error?: string;
      };
      if (!res.ok || !data.reply) throw new Error(data.error ?? "The preview didn't answer.");
      setTurns((prev) => [
        ...prev,
        {
          role: "assistant",
          body: data.reply!,
          sources: data.citations?.map((c) => c.title),
          escalated: data.escalated,
        },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The preview didn't answer.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div role="region" aria-label="Chat preview" className="overflow-hidden rounded-xl border border-line bg-card">
      <div className="max-h-96 space-y-3 overflow-y-auto px-4 py-4">
        {turns.length === 0 ? (
          <p className="text-sm text-muted">
            {disabled ? "Add an article first, then ask about it here." : `Ask ${businessName} something.`}
          </p>
        ) : null}
        {turns.map((turn, i) =>
          turn.role === "visitor" ? (
            <p key={i} className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-forest px-3.5 py-2 text-sm text-paper">
              {turn.body}
            </p>
          ) : (
            <div key={i} className="max-w-[85%]">
              <p className="whitespace-pre-wrap rounded-2xl rounded-tl-md bg-paper px-3.5 py-2 text-sm leading-6">{turn.body}</p>
              <p className="mt-1 text-[11px] text-muted">
                {turn.escalated
                  ? "On your site this would open a ticket in your inbox."
                  : turn.sources?.length
                    ? `From "${turn.sources[0]}"`
                    : null}
              </p>
            </div>
          ),
        )}
        {pending ? <p role="status" className="text-xs text-muted">Looking through your articles…</p> : null}
      </div>
      <form onSubmit={send} className="flex gap-2 border-t border-line p-3">
        <input
          aria-label="Preview message"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={disabled}
          placeholder="Type a question a customer would ask"
          className={inputClass}
        />
        <button type="submit" disabled={disabled || pending} className={`${primaryButton} shrink-0`}>
          Ask
        </button>
      </form>
      <div className="px-3 pb-2">
        <ErrorLine error={error} />
      </div>
    </div>
  );
}
