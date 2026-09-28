"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function ReplyForm({ ticketId, email }: { ticketId: string; email: string }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function send() {
    const text = body.trim();
    if (!text || pending) return;
    setError(null);
    setPending(true);
    const res = await fetch(`/api/tickets/${ticketId}/reply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: text }),
    });
    setPending(false);
    if (!res.ok) {
      setError("Could not send");
      return;
    }
    setBody("");
    router.refresh();
  }

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    void send();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void send();
    }
  }

  return (
    <form onSubmit={onSubmit} className="border-t border-line bg-card p-4">
      <textarea
        required
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={onKeyDown}
        rows={3}
        placeholder={`Reply to ${email}…`}
        className="w-full resize-none rounded-lg border border-line bg-paper px-3 py-2 text-sm outline-none ring-forest/20 focus:ring-2"
      />
      {error ? <p role="alert" className="mt-1 text-sm text-copper">{error}</p> : null}
      <div className="mt-2 flex items-center justify-between">
        <p className="text-[11px] text-muted">⌘ Enter to send</p>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-forest px-3.5 py-1.5 text-sm text-paper transition hover:bg-forest-2 active:scale-[0.98] disabled:opacity-50"
        >
          Send
        </button>
      </div>
    </form>
  );
}
