"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { formatRelative, IconSearch, Initials, StatusPill } from "@/components/ui";
import type { Ticket } from "@/lib/models";

const FILTERS = ["all", "open", "waiting", "closed"] as const;

export function TicketList({
  tickets,
  activeId,
}: {
  tickets: Ticket[];
  activeId: string | null;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  const q = query.trim().toLowerCase();

  const visible = useMemo(() => {
    return tickets.filter((ticket) => {
      if (filter !== "all" && ticket.status !== filter) return false;
      if (!q) return true;
      return (
        ticket.email.toLowerCase().includes(q) ||
        ticket.preview.toLowerCase().includes(q) ||
        ticket.id.toLowerCase().includes(q)
      );
    });
  }, [tickets, filter, q]);

  return (
    <section className="flex h-full min-h-0 w-full flex-col border-r border-line bg-card">
      <header className="border-b border-line px-4 py-3">
        <div className="flex items-baseline justify-between">
          <h1 className="text-sm font-medium">Inbox</h1>
          <p className="text-xs text-muted">{tickets.length}</p>
        </div>
        <label className="relative mt-3 block">
          <span className="sr-only">Search tickets</span>
          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted">
            <IconSearch />
          </span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            className="w-full rounded-md border border-line bg-paper py-1.5 pl-8 pr-3 text-sm outline-none ring-forest/20 focus:ring-2"
          />
        </label>
        <div className="mt-3 flex gap-1">
          {FILTERS.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={
                filter === key
                  ? "rounded-md bg-forest px-2 py-1 text-[11px] capitalize text-paper"
                  : "rounded-md px-2 py-1 text-[11px] capitalize text-muted hover:bg-paper"
              }
            >
              {key}
            </button>
          ))}
        </div>
      </header>
      {visible.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-muted">
          {tickets.length === 0
            ? "No tickets yet. Escalate one from the widget."
            : "Nothing in this view."}
        </p>
      ) : (
        <ul className="flex-1 overflow-y-auto">
          {visible.map((ticket) => {
            const active = ticket.id === activeId;
            return (
              <li key={ticket.id} className="border-b border-line">
                <Link
                  href={`/inbox/${ticket.id}`}
                  className={
                    active
                      ? "flex gap-3 bg-forest/10 px-4 py-3"
                      : "flex gap-3 px-4 py-3 hover:bg-paper"
                  }
                >
                  <Initials email={ticket.email} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="truncate text-sm font-medium">
                        {ticket.email.split("@")[0]}
                      </p>
                      <p className="shrink-0 text-[11px] text-muted">
                        {formatRelative(ticket.updated_at)}
                      </p>
                    </div>
                    <p className="mt-0.5 truncate text-sm text-muted">{ticket.preview}</p>
                    <div className="mt-1.5 flex items-center gap-2">
                      <StatusPill status={ticket.status} />
                      <span className="text-[11px] text-muted">
                        {ticket.assignee ?? "Unassigned"}
                      </span>
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
