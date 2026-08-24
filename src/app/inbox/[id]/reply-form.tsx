"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function ReplyForm({ ticketId }: { ticketId: string }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const res = await fetch(`/api/tickets/${ticketId}/reply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
    });
    if (!res.ok) {
      setError("Could not send");
      return;
    }
    setBody("");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="mt-10 border-t border-[#2c342f] pt-6">
      <textarea
        required
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={4}
        placeholder="Reply as Nimbus support…"
        className="w-full rounded-xl border border-[#2c342f] bg-[#1a1f1c] px-3 py-2 text-sm outline-none"
      />
      {error ? <p className="mt-2 text-sm text-[#e07a4c]">{error}</p> : null}
      <button
        type="submit"
        className="mt-3 rounded-lg bg-[#cfe0d4] px-4 py-2 text-sm text-[#121613]"
      >
        Send reply
      </button>
    </form>
  );
}
