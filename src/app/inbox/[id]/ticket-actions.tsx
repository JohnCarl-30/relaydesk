"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function TicketActions({
  ticketId,
  status,
  assignee,
  staffNames,
}: {
  ticketId: string;
  status: string;
  assignee: string | null;
  /** The business's staff, who tickets can be given to. */
  staffNames: string[];
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
          {/* Keep a former teammate's name selectable on tickets still assigned to them. */}
          {[...new Set([...staffNames, ...(assignee ? [assignee] : [])])].map((agent) => (
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
            ? "rounded-md border border-line px-2.5 py-1 text-xs transition hover:bg-paper active:scale-[0.98]"
            : "rounded-md bg-forest px-2.5 py-1 text-xs text-paper transition hover:bg-forest-2 active:scale-[0.98]"
        }
      >
        {closed ? "Reopen" : "Close"}
      </button>
    </div>
  );
}
