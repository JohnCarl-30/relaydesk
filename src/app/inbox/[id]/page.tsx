import Link from "next/link";
import { notFound } from "next/navigation";
import { formatClock, Initials, StatusPill } from "@/components/ui";
import { getTicket, listMessages } from "@/lib/db";
import { ReplyForm } from "./reply-form";
import { TicketActions } from "./ticket-actions";

export default async function TicketPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ticket = getTicket(id);
  if (!ticket) notFound();
  const messages = listMessages(ticket.conversation_id);
  const name = ticket.email.split("@")[0];

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-card px-5 py-3">
          <div className="min-w-0">
            <Link href="/inbox" className="text-xs text-muted hover:text-ink lg:hidden">
              Inbox
            </Link>
            <h1 className="truncate text-sm font-medium">{ticket.preview}</h1>
            <p className="truncate text-xs text-muted">{ticket.email}</p>
          </div>
          <TicketActions
            ticketId={ticket.id}
            status={ticket.status}
            assignee={ticket.assignee}
          />
        </header>

        <ol className="flex-1 space-y-4 overflow-y-auto px-5 py-6">
          {messages.map((message) => {
            const visitor = message.role === "visitor";
            const agent = message.role === "agent";
            const label = visitor ? name : agent ? "You" : "Bot";
            return (
              <li key={message.id} className={visitor ? "mr-10" : "ml-10"}>
                <p className="mb-1 text-[11px] text-muted">
                  {label} · {formatClock(message.created_at)}
                </p>
                <div
                  className={
                    visitor
                      ? "rounded-lg rounded-tl-sm border border-line bg-card px-4 py-3"
                      : agent
                        ? "rounded-lg rounded-tr-sm bg-forest px-4 py-3 text-paper"
                        : "rounded-lg border border-line bg-card px-4 py-3"
                  }
                >
                  <p className="whitespace-pre-wrap text-sm leading-6">{message.body}</p>
                </div>
              </li>
            );
          })}
        </ol>

        {ticket.status === "closed" ? (
          <p className="border-t border-line bg-card px-5 py-3 text-sm text-muted">
            Closed. Reopen to reply.
          </p>
        ) : (
          <ReplyForm ticketId={ticket.id} email={ticket.email} />
        )}
      </section>

      <aside className="hidden w-72 shrink-0 flex-col border-l border-line bg-card xl:flex">
        <div className="border-b border-line px-4 py-4">
          <p className="text-[11px] font-medium uppercase tracking-widest text-muted">
            Customer
          </p>
          <div className="mt-3 flex items-center gap-3">
            <Initials email={ticket.email} />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{name}</p>
              <p className="truncate text-xs text-muted">{ticket.email}</p>
            </div>
          </div>
        </div>
        <dl className="space-y-4 px-4 py-4 text-sm">
          <div>
            <dt className="text-[11px] uppercase tracking-widest text-muted">Status</dt>
            <dd className="mt-1">
              <StatusPill status={ticket.status} />
            </dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-widest text-muted">Given to</dt>
            <dd className="mt-1 text-xs">{ticket.assignee ?? "Unassigned"}</dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-widest text-muted">Ticket</dt>
            <dd className="mt-1 font-mono text-xs">{ticket.id}</dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-widest text-muted">Opened</dt>
            <dd className="mt-1 text-xs">{formatClock(ticket.created_at)}</dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-widest text-muted">Updated</dt>
            <dd className="mt-1 text-xs">{formatClock(ticket.updated_at)}</dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-widest text-muted">Messages</dt>
            <dd className="mt-1 text-xs">{messages.length}</dd>
          </div>
        </dl>
      </aside>
    </div>
  );
}
