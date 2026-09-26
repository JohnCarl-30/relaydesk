import Link from "next/link";
import { DashboardPreview } from "@/components/DashboardPreview";

const STEPS = [
  {
    n: "1",
    title: "Ask",
    lead: '"Why is my invoice 12 seats?"',
    body: "The widget searches the help center and answers with a citation.",
  },
  {
    n: "2",
    title: "Escalate",
    lead: '"This didn\'t help"',
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
              className="rounded-lg bg-forest px-4 py-2.5 text-sm text-paper hover:bg-forest-2"
            >
              Get started free
            </Link>
            <Link
              href="/inbox"
              className="rounded-lg border border-ink/15 bg-card px-4 py-2.5 text-sm hover:bg-paper"
            >
              Open inbox
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

      <section className="px-6 py-20">
        <p className="text-center text-[11px] font-medium uppercase tracking-[0.16em] text-muted">
          How it works
        </p>
        <h2 className="mx-auto mt-3 max-w-xl text-center font-serif text-3xl tracking-tight sm:text-4xl">
          No contact form. The widget files the ticket.
        </h2>
        <div className="mx-auto mt-14 grid max-w-5xl gap-10 sm:grid-cols-3">
          {STEPS.map((step) => (
            <div key={step.n}>
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-forest text-sm text-paper">
                {step.n}
              </span>
              <p className="mt-4 text-xs uppercase tracking-widest text-muted">{step.title}</p>
              <p className="mt-2 font-serif text-2xl">{step.lead}</p>
              <p className="mt-2 text-sm leading-6 text-muted">{step.body}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-line px-6 py-10">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted">
            Nimbus · a Relaydesk demo. Inbox password{" "}
            <code className="text-ink">nimbus-demo</code>.
          </p>
          <div className="flex gap-6 text-sm text-muted">
            <Link href="/help" className="hover:text-ink">
              Help
            </Link>
            <Link href="/inbox" className="hover:text-ink">
              Inbox
            </Link>
            <Link href="/login" className="hover:text-ink">
              Log in
            </Link>
          </div>
        </div>
      </footer>
    </main>
  );
}
