import Link from "next/link";
import { DashboardPreview } from "@/components/DashboardPreview";
import { OpenChatButton } from "@/components/OpenChatButton";
import { IconChevron } from "@/components/ui";

const STEPS = [
  {
    n: "1",
    title: "Ask",
    lead: "“Why is my invoice 12 seats?”",
    body: "The widget searches the help center and answers with a citation.",
  },
  {
    n: "2",
    title: "Escalate",
    lead: "“This didn’t help”",
    body: "Leave an email. A ticket lands in the staff inbox with the full transcript.",
  },
  {
    n: "3",
    title: "Reply",
    lead: "A human takes it",
    body: "Demo inbox password is nimbus-demo. Two seeded tickets are already waiting.",
  },
];

export default function HomePage() {
  return (
    <main>
      <section className="mx-auto grid max-w-6xl items-center gap-12 px-6 pb-8 pt-14 lg:grid-cols-[minmax(0,1fr)_1.15fr] lg:pt-20">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-copper">
            Product analytics
          </p>
          <h1 className="mt-4 font-serif text-4xl leading-[1.08] tracking-tight text-ink sm:text-5xl">
            Charts that tell you what users did, not what they said they would.
          </h1>
          <p className="mt-5 max-w-md text-base leading-7 text-muted">
            Nimbus is a fake analytics company. The chat bubble is the product
            you&apos;re trying. It searches this help center, cites the article,
            and files a ticket when you say it failed.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              href="/help"
              className="rounded-lg bg-forest px-4 py-2.5 text-sm text-paper transition hover:bg-forest-2 active:scale-[0.98]"
            >
              Get started free
            </Link>
            <Link
              href="/inbox"
              className="group inline-flex items-center gap-1 px-1 py-2.5 text-sm text-muted transition-colors hover:text-ink"
            >
              See the staff inbox
              <IconChevron className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
            </Link>
          </div>
        </div>
        <div className="rounded-2xl bg-[linear-gradient(180deg,#e4ece6_0%,#f3eee4_80%)] p-3 sm:p-5">
          <DashboardPreview />
        </div>
      </section>

      <section className="border-y border-line px-6 py-8">
        <p className="text-center text-[11px] uppercase tracking-[0.18em] text-muted">
          Trusted by teams that do not exist
        </p>
        <ul className="mx-auto mt-4 flex max-w-4xl flex-wrap items-center justify-center gap-x-10 gap-y-2 text-sm font-medium text-ink/35">
          {["Northline", "Harbor", "Pineshift", "Lumen", "Kite"].map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
      </section>

      <section className="mx-auto grid max-w-6xl gap-12 px-6 pb-24 pt-20 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-20">
        <div className="lg:sticky lg:top-24 lg:self-start">
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted">
            How it works
          </p>
          <h2 className="mt-3 max-w-md font-serif text-3xl tracking-tight sm:text-4xl">
            No contact form. The widget files the ticket.
          </h2>
          <p className="mt-4 max-w-sm text-muted">
            Three steps, one conversation. Try them with the bubble in the corner.
          </p>
          <OpenChatButton className="group mt-6 inline-flex items-center gap-1 text-sm text-forest transition-colors hover:text-forest-2">
            Open the chat
            <IconChevron className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
          </OpenChatButton>
        </div>
        <ol className="divide-y divide-line border-y border-line">
          {STEPS.map((step) => (
            <li key={step.n} className="grid grid-cols-[2.75rem_minmax(0,1fr)] gap-3 py-8">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-forest text-sm tabular-nums text-paper">
                {step.n}
              </span>
              <div>
                <p className="text-xs uppercase tracking-widest text-muted">{step.title}</p>
                <p className="mt-2 font-serif text-2xl">{step.lead}</p>
                <p className="mt-2 max-w-md text-sm leading-6 text-muted">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <footer className="border-t border-line py-10">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted">
            Nimbus · a Relaydesk demo. Inbox password{" "}
            <code className="text-ink">nimbus-demo</code>.
          </p>
          <div className="flex gap-6 text-sm text-muted">
            <Link href="/help" className="transition-colors hover:text-ink">
              Help
            </Link>
            <Link href="/inbox" className="transition-colors hover:text-ink">
              Inbox
            </Link>
            <Link href="/login" className="transition-colors hover:text-ink">
              Log in
            </Link>
          </div>
        </div>
      </footer>
    </main>
  );
}
