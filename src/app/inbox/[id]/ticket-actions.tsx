"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AGENTS } from "@/lib/models";

export function TicketActions({
  ticketId,
  status,
  assignee,
}: {
  ticketId: string;
  status: string;
  assignee: string | null;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const closed = status === "closed";

  async function patch(body: { status?: string; assignee?: string | null }) {
    if (pending) return;
    setPending(true);
    const res = await fetch(`/api/tickets/${ticketId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setPending(false);
    if (res.ok) router.refresh();
  }

  return (
    <div className="flex shrink-0 items-center gap-2">
      <label className="flex items-center gap-2 text-xs text-muted">
        Give to
        <select
          value={assignee ?? ""}
          disabled={pending}
          onChange={(e) =>
            void patch({ assignee: e.target.value === "" ? null : e.target.value })
          }
          className="rounded-md border border-line bg-paper px-2 py-1 text-xs text-ink outline-none"
        >
          <option value="">Unassigned</option>
          {AGENTS.map((agent) => (
            <option key={agent} value={agent}>
              {agent}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        disabled={pending}
        onClick={() => void patch({ status: closed ? "open" : "closed" })}
        className={
          closed
            ? "rounded-md border border-line px-2.5 py-1 text-xs hover:bg-paper"
            : "rounded-md bg-forest px-2.5 py-1 text-xs text-paper hover:bg-forest-2"
        }
      >
        {closed ? "Reopen" : "Close"}
      </button>
    </div>
  );
}
