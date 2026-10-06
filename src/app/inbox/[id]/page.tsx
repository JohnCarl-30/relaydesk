import Link from "next/link";
import { notFound } from "next/navigation";
import { formatClock, Initials, StatusPill } from "@/components/ui";
import { helpHrefForTitle } from "@/lib/articles";
import { copilotEnabled } from "@/lib/copilot";
import { getPendingDraft, getTicket, listMessages, listRuns } from "@/lib/db";
import { DraftCard, type DraftView } from "./draft-card";
import { ReplyForm } from "./reply-form";
import { TicketActions } from "./ticket-actions";

const RUN_LABEL: Record<string, string> = {
  answer: "Drafted an answer",
  holding: "Drafted a holding reply",
  disabled: "Skipped: co-pilot off",
  rate_limited: "Skipped: daily limit",
  error: "Drafting failed",
};

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
  const pending = getPendingDraft(ticket.id);
  const draft: DraftView | null = pending
    ? {
        id: pending.id,
        kind: pending.kind,
        body: pending.body,
        rationale: pending.rationale,
        model: pending.model,
        related: pending.citations ? (JSON.parse(pending.citations) as string[]) : [],
      }
    : null;
  const runs = listRuns(ticket.id, 4);

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-card px-5 py-3">
          <div className="min-w-0">
            <Link href="/inbox" className="text-xs text-muted hover:text-ink lg:hidden">
              Inbox
            </Link>
            <h1 className="truncate text-sm font-medium">{ticket.summary ?? ticket.preview}</h1>
            <p className="truncate text-xs text-muted">{ticket.email}</p>
          </div>
          <TicketActions
            ticketId={ticket.id}
            status={ticket.status}
            assignee={ticket.assignee}
          />
        </header>

        <ol className="flex-1 space-y-5 overflow-y-auto px-5 py-6">
          {messages.map((message) => {
            const visitor = message.role === "visitor";
            const agent = message.role === "agent";
            const label = visitor ? name : agent ? "You" : "Nimbus bot";
            // Bot replies store the articles they drew on; the first is the one quoted.
            const source =
              !visitor && !agent && message.citations
                ? (JSON.parse(message.citations) as string[])[0]
                : undefined;
            return (
              <li
                key={message.id}
                className={visitor ? "mr-10 flex gap-3" : "ml-10 flex flex-row-reverse gap-3"}
              >
                {visitor ? (
                  <Initials email={ticket.email} />
                ) : (
                  <span
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs ${
                      agent ? "bg-forest text-paper" : "border border-forest/20 bg-forest/5 text-forest"
                    }`}
                    aria-hidden
                  >
                    {agent ? "Y" : <span className="h-2 w-2 rounded-full bg-forest" />}
                  </span>
                )}
                <div className={`min-w-0 ${visitor ? "" : "flex flex-col items-end"}`}>
                  <p className="mb-1 flex items-center gap-1.5 text-[11px] tabular-nums text-muted">
                    <span className="font-medium text-ink">{label}</span>
                    {!visitor && !agent ? (
                      <span className="rounded bg-forest/10 px-1 py-px text-[10px] font-medium uppercase tracking-wide text-forest">
                        Bot
                      </span>
                    ) : null}
                    <span>· {formatClock(message.created_at)}</span>
                  </p>
                  <div
                    className={
                      visitor
                        ? "rounded-2xl rounded-tl-md border border-line bg-card px-4 py-3"
                        : agent
                          ? "rounded-2xl rounded-tr-md bg-forest px-4 py-3 text-paper"
                          : "rounded-2xl rounded-tr-md border border-forest/15 bg-forest/5 px-4 py-3"
                    }
                  >
                    <p className="whitespace-pre-wrap text-sm leading-6">{message.body}</p>
                  </div>
                  {source ? (
                    <p className="mt-1.5 text-[11px] text-muted">
                      Answer based on{" "}
                      <Link
                        href={helpHrefForTitle(source)}
                        className="text-ink underline-offset-2 hover:text-forest hover:underline"
                      >
                        {source}
                      </Link>
                    </p>
                  ) : null}
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
          <>
            <DraftCard
              key={draft?.id ?? "none"}
              ticketId={ticket.id}
              draft={draft}
              needsHumanReason={ticket.needs_human_reason}
              enabled={copilotEnabled()}
            />
            <ReplyForm ticketId={ticket.id} email={ticket.email} />
          </>
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
        <dl className="divide-y divide-line px-4 text-sm">
          <div className="flex items-center justify-between gap-3 py-2.5">
            <dt className="text-muted">Status</dt>
            <dd className="text-right tabular-nums"><StatusPill status={ticket.status} /></dd>
          </div>
          <div className="flex items-center justify-between gap-3 py-2.5">
            <dt className="text-muted">Given to</dt>
            <dd className="text-right tabular-nums">{ticket.assignee ?? "Unassigned"}</dd>
          </div>
          <div className="flex items-center justify-between gap-3 py-2.5">
            <dt className="text-muted">Ticket</dt>
            <dd className="text-right tabular-nums"><span className="font-mono text-xs">{ticket.id}</span></dd>
          </div>
          <div className="flex items-center justify-between gap-3 py-2.5">
            <dt className="text-muted">Opened</dt>
            <dd className="text-right tabular-nums">{formatClock(ticket.created_at)}</dd>
          </div>
          <div className="flex items-center justify-between gap-3 py-2.5">
            <dt className="text-muted">Updated</dt>
            <dd className="text-right tabular-nums">{formatClock(ticket.updated_at)}</dd>
          </div>
          <div className="flex items-center justify-between gap-3 py-2.5">
            <dt className="text-muted">Messages</dt>
            <dd className="text-right tabular-nums">{messages.length}</dd>
          </div>
        </dl>
        {ticket.summary || runs.length ? (
          <div className="border-t border-line px-4 py-4">
            <p className="text-[11px] font-medium uppercase tracking-widest text-muted">Co-pilot</p>
            {ticket.summary ? (
              <p className="mt-2 text-sm">
                {ticket.topic ? (
                  <span className="mr-1.5 rounded bg-forest/10 px-1.5 py-px text-[11px] text-forest">{ticket.topic}</span>
                ) : null}
                {ticket.summary}
              </p>
            ) : null}
            {runs.length ? (
              <ol className="mt-3 space-y-1.5 text-xs text-muted">
                {runs.map((run) => (
                  <li key={run.id} className="flex justify-between gap-2 tabular-nums">
                    <span>{RUN_LABEL[run.outcome] ?? run.outcome}</span>
                    <span>{formatClock(run.created_at)}</span>
                  </li>
                ))}
              </ol>
            ) : null}
          </div>
        ) : null}
      </aside>
    </div>
  );
}
