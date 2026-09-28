"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { logout } from "./actions";
import { TicketList } from "./ticket-list";
import type { Ticket } from "@/lib/models";

export function InboxShell({
  tickets,
  children,
}: {
  tickets: Ticket[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const onTicket = pathname.startsWith("/inbox/") && pathname !== "/inbox";

  return (
    <div className="flex h-dvh overflow-hidden bg-paper text-ink">
      <aside
        data-surface="dark"
        className="flex w-14 shrink-0 flex-col items-center border-r border-forest-2/40 bg-forest py-3 text-paper"
      >
        <Link
          href="/"
          className="flex h-8 w-8 items-center justify-center rounded-full bg-paper/15 text-xs font-medium"
          title="Nimbus"
        >
          N
        </Link>
        <nav className="mt-6 flex flex-1 flex-col items-center gap-1">
          <Link
            href="/inbox"
            className="flex h-9 w-9 items-center justify-center rounded-lg bg-paper/15"
            title="Inbox"
            aria-label="Inbox"
            aria-current="page"
          >
            <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" aria-hidden>
              <path
                d="M3.5 7.5 10 3l6.5 4.5v7A1.5 1.5 0 0 1 15 16H5A1.5 1.5 0 0 1 3.5 14.5v-7Z"
                stroke="currentColor"
                strokeWidth="1.5"
              />
              <path d="M7 16v-4.5h6V16" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </Link>
          <Link
            href="/help"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-paper/70 transition-colors hover:bg-paper/10 hover:text-paper"
            title="Help"
            aria-label="Help center"
          >
            <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" aria-hidden>
              <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5" />
              <path
                d="M8.2 7.8c.4-.8 1.2-1.3 2.1-1.3 1.2 0 2 .7 2 1.8 0 1.1-.8 1.6-1.6 2-.5.2-.8.5-.8 1.1v.3"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
              <circle cx="10.2" cy="14" r="0.7" fill="currentColor" />
            </svg>
          </Link>
        </nav>
        <form action={logout}>
          <button
            type="submit"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-paper/70 transition-colors hover:bg-paper/10 hover:text-paper"
            title="Log out"
            aria-label="Log out"
          >
            <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" aria-hidden>
              <path
                d="M8 4H5.5A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8M11 13l3-3-3-3M14 10H8"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </form>
      </aside>

      <div className={onTicket ? "hidden min-h-0 w-80 shrink-0 lg:flex" : "flex min-h-0 w-full shrink-0 lg:w-80"}>
        <TicketList tickets={tickets} activeId={onTicket ? pathname.slice("/inbox/".length) : null} />
      </div>

      <div className={onTicket ? "flex min-h-0 min-w-0 flex-1" : "hidden min-h-0 min-w-0 flex-1 lg:flex"}>
        {children}
      </div>
    </div>
  );
}
