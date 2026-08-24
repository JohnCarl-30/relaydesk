import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { getTicket, listMessages } from "@/lib/db";
import { ReplyForm } from "./reply-form";

export default async function TicketPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!(await isAdmin())) redirect("/login");
  const { id } = await params;
  const ticket = getTicket(id);
  if (!ticket) notFound();
  const messages = listMessages(ticket.conversation_id);

  return (
    <div className="min-h-full bg-[#121613] text-[#e8eee9]">
      <header className="border-b border-[#2c342f] px-6 py-4">
        <Link href="/inbox" className="text-xs text-[#8aa396] hover:text-[#e8eee9]">
          ← Inbox
        </Link>
        <h1 className="mt-2 text-lg font-medium">{ticket.preview}</h1>
        <p className="mt-1 text-sm text-[#8aa396]">
          {ticket.email} · {ticket.status} · {ticket.id}
        </p>
      </header>
      <main className="mx-auto max-w-2xl px-6 py-8">
        <ol className="space-y-4">
          {messages.map((message) => (
            <li
              key={message.id}
              className={
                message.role === "visitor"
                  ? "rounded-2xl border border-[#2c342f] bg-[#1a1f1c] px-4 py-3"
                  : "rounded-2xl px-4 py-3"
              }
            >
              <p className="text-[10px] uppercase tracking-widest text-[#8aa396]">
                {message.role === "visitor"
                  ? "Customer"
                  : message.role === "agent"
                    ? "You"
                    : "Bot"}
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm leading-6">{message.body}</p>
            </li>
          ))}
        </ol>
        <ReplyForm ticketId={ticket.id} />
      </main>
    </div>
  );
}
