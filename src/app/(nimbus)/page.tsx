import Link from "next/link";

export default function HomePage() {
  return (
    <main>
      <section className="mx-auto max-w-5xl px-6 pb-24 pt-16">
        <p className="text-sm text-copper">Demo product · powered by Relaydesk</p>
        <h1 className="mt-4 max-w-2xl font-serif text-5xl leading-[1.1] tracking-tight text-ink sm:text-6xl">
          Charts that tell you what users did, not what they said they would.
        </h1>
        <p className="mt-6 max-w-xl text-lg leading-7 text-muted">
          Nimbus is a fictional analytics SaaS. The chat bubble is a real support
          product: it answers from this help center, cites the article, and
          opens a ticket when it cannot help.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/help"
            className="rounded-full bg-forest px-5 py-2.5 text-sm text-paper hover:bg-forest-2"
          >
            Browse help
          </Link>
          <Link
            href="/inbox"
            className="rounded-full border border-line px-5 py-2.5 text-sm hover:bg-card"
          >
            Open the inbox
          </Link>
        </div>
      </section>
      <section className="border-t border-line bg-card">
        <div className="mx-auto grid max-w-5xl gap-10 px-6 py-16 sm:grid-cols-3">
          <div>
            <p className="text-xs uppercase tracking-widest text-muted">Ask</p>
            <p className="mt-2 font-serif text-2xl">“Why is my invoice 12 seats?”</p>
            <p className="mt-2 text-sm leading-6 text-muted">
              The widget retrieves billing articles and answers with a citation.
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-widest text-muted">Escalate</p>
            <p className="mt-2 font-serif text-2xl">“This didn’t help”</p>
            <p className="mt-2 text-sm leading-6 text-muted">
              Visitor leaves an email. A ticket appears in the staff inbox with
              the full transcript.
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-widest text-muted">Reply</p>
            <p className="mt-2 font-serif text-2xl">A human takes it</p>
            <p className="mt-2 text-sm leading-6 text-muted">
              Password for the demo inbox is <code>nimbus-demo</code>. Two
              seeded tickets are already waiting.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
