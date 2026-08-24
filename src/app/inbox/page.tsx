import Link from "next/link";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { listTickets } from "@/lib/db";
import { logout } from "./actions";

function formatTime(iso: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

export default async function InboxPage() {
  if (!(await isAdmin())) redirect("/login");
  const tickets = listTickets();

  return (
    <div className="min-h-full bg-[#121613] text-[#e8eee9]">
      <header className="flex items-center justify-between border-b border-[#2c342f] px-6 py-4">
        <div>
          <p className="text-xs uppercase tracking-widest text-[#8aa396]">Relaydesk</p>
          <h1 className="text-lg font-medium">Inbox · Nimbus</h1>
        </div>
        <div className="flex items-center gap-4 text-sm text-[#8aa396]">
          <Link href="/" className="hover:text-[#e8eee9]">
            Customer site
          </Link>
          <form action={logout}>
            <button type="submit" className="hover:text-[#e8eee9]">
              Log out
            </button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-8">
        {tickets.length === 0 ? (
          <p className="text-[#8aa396]">No tickets yet. Escalate one from the widget.</p>
        ) : (
          <ul className="divide-y divide-[#2c342f] border-y border-[#2c342f]">
            {tickets.map((ticket) => (
              <li key={ticket.id}>
                <Link
                  href={`/inbox/${ticket.id}`}
                  className="flex items-baseline justify-between gap-4 py-4 hover:bg-[#1a1f1c]"
                >
                  <div>
                    <p className="text-sm">{ticket.preview}</p>
                    <p className="mt-1 text-xs text-[#8aa396]">{ticket.email}</p>
                  </div>
                  <div className="shrink-0 text-right text-xs text-[#8aa396]">
                    <p className="uppercase tracking-widest">{ticket.status}</p>
                    <p className="mt-1">{formatTime(ticket.updated_at)}</p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
