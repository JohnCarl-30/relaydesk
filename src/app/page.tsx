import type { Metadata } from "next";
import Link from "next/link";
import { HeroChat, InboxSwitch, Reveal, RevealHeadline } from "@/components/landing";
import { IconChevron } from "@/components/ui";

const REPO = "https://github.com/JohnCarl-30/relaydesk";

const description =
  "A help desk for Philippine businesses. It answers customers from your FAQ and passes the questions it can't answer to your team.";

export const metadata: Metadata = {
  title: "Relaydesk, answers your customers from your own FAQ",
  description,
  openGraph: { title: "Relaydesk", description, siteName: "Relaydesk", type: "website" },
};

const PROMISES = [
  {
    title: "Answers from your FAQ",
    body: "Every reply links the FAQ entry it came from, so customers can check it and you can see why it said what it said.",
  },
  {
    title: "Taglish is fine",
    body: "Customers can ask in English or Taglish, typed or by voice, in the chat on your site.",
  },
  {
    title: "Passes on what it can't answer",
    body: "When your FAQ doesn't cover a question, the customer leaves an email and your team gets a ticket with the whole conversation.",
  },
];

const STEPS = [
  { title: "Paste your FAQ", body: "Or import a Markdown file where each heading is a question. Relaydesk answers only from what's in it." },
  { title: "Add the widget", body: "Copy one script tag into your site. The chat bubble shows up in the corner." },
  { title: "Work the inbox", body: "Only the questions it couldn't answer land here, with the conversation attached." },
];

const UNDER_THE_HOOD = [
  { stat: "55/60", label: "labeled questions find the right article in the top 3", href: `${REPO}/blob/main/eval/README.md` },
  { stat: "1.00", label: "precision on when to open a ticket, over 23 labeled questions", href: `${REPO}/blob/main/eval/escalation.md` },
  { stat: "Every PR", label: "gated by Langfuse experiments before it can merge", href: `${REPO}/blob/main/.github/workflows/experiments.yml` },
  { stat: "Docker", label: "self-hosting with daily backups and a tested restore", href: `${REPO}/blob/main/RUNBOOK.md` },
];

function Brand() {
  return (
    <span className="inline-flex items-center gap-2 font-medium tracking-tight text-forest">
      <span className="relative inline-block h-4 w-4 rounded-[5px] bg-forest">
        <span className="absolute -bottom-1 -right-1 h-2 w-2 rounded-full border-2 border-paper bg-copper" />
      </span>
      Relaydesk
    </span>
  );
}

function PrimaryCta() {
  return (
    <Link
      href="/signup"
      className="group inline-flex items-center gap-1.5 rounded-full bg-forest px-5 py-3 text-sm font-medium text-paper transition hover:bg-forest-2 active:scale-[0.97]"
    >
      Set up your help desk
      <IconChevron className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

const fadeUp =
  "translate-y-2 opacity-0 transition duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-data-seen:translate-y-0 group-data-seen:opacity-100";

export default function LandingPage() {
  return (
    <div className="min-h-full bg-paper text-ink">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-forest px-3 py-2 text-sm text-paper focus:not-sr-only focus:fixed focus:left-4 focus:top-3"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-30 border-b border-line/80 bg-paper/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6 text-sm">
          <Link href="/">
            <Brand />
          </Link>
          <nav aria-label="Main" className="flex items-center gap-1 sm:gap-5">
            <a href="#how" className="hidden px-2 py-1.5 text-muted transition-colors hover:text-ink sm:block">
              How it works
            </a>
            <Link href="/demo" className="hidden px-2 py-1.5 text-muted transition-colors hover:text-ink sm:block">
              Demo
            </Link>
            <Link href="/login" className="px-2 py-1.5 text-muted transition-colors hover:text-ink">
              Log in
            </Link>
            <Link
              href="/signup"
              className="rounded-full bg-forest px-3.5 py-1.5 text-paper transition hover:bg-forest-2 active:scale-[0.97]"
            >
              Start free
            </Link>
          </nav>
        </div>
      </header>

      <main id="main" tabIndex={-1} className="outline-none">
        <section className="mx-auto grid max-w-6xl items-center gap-12 px-6 pb-16 pt-14 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)] lg:pt-20">
          <Reveal>
            <p className={`text-sm font-medium text-copper ${fadeUp}`}>
              For Philippine businesses that answer the same questions all day
            </p>
            <RevealHeadline
              className="mt-4 font-serif text-[2.6rem] leading-[1.04] tracking-tight sm:text-5xl xl:text-[3.25rem]"
              lines={[
                "Answers your customers",
                "from your own FAQ.",
                <em key="hand-off" className="text-forest">
                  The hard ones come to you.
                </em>,
              ]}
            />
            <p className={`mt-6 max-w-md leading-7 text-muted delay-500 ${fadeUp}`}>
              Relaydesk sits on your website, answers from your FAQ, and links the entry it used. When your FAQ
              doesn&apos;t cover a question, it opens a ticket for your team.
            </p>
            <div className={`mt-8 flex flex-wrap items-center gap-3 delay-[600ms] ${fadeUp}`}>
              <PrimaryCta />
              <Link
                href="/demo"
                className="rounded-full px-5 py-3 text-sm font-medium shadow-[inset_0_0_0_1px_var(--line)] transition hover:bg-card active:scale-[0.97]"
              >
                Try the demo
              </Link>
            </div>
            <p className={`mt-4 text-[13px] text-muted delay-700 ${fadeUp}`}>
              Paste your FAQ, add one line to your site. No call with sales.
            </p>
          </Reveal>
          <HeroChat />
        </section>

        <section className="border-t border-line">
          <div className="mx-auto max-w-3xl px-6 py-20 sm:py-24">
            <InboxSwitch />
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-6 pb-20">
          <Reveal className="grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-3">
            {PROMISES.map((p, i) => (
              <div
                key={p.title}
                style={{ transitionDelay: `${i * 100}ms` }}
                className={`bg-card p-6 ${fadeUp}`}
              >
                <span className="text-xs font-medium tabular-nums text-copper">0{i + 1}</span>
                <h3 className="mt-3 font-serif text-xl tracking-tight">{p.title}</h3>
                <p className="mt-2 text-sm leading-6 text-muted">{p.body}</p>
              </div>
            ))}
          </Reveal>
        </section>

        <section id="how" className="scroll-mt-14 border-t border-line">
          <div className="mx-auto grid max-w-6xl gap-12 px-6 py-20 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-20">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted">How it works</p>
              <h2 className="mt-3 max-w-sm font-serif text-3xl tracking-tight sm:text-4xl">
                Set up in three steps.
              </h2>
              <div className="mt-8">
                <PrimaryCta />
              </div>
            </div>
            <Reveal>
              <ol className="divide-y divide-line border-y border-line">
                {STEPS.map((step, i) => (
                  <li
                    key={step.title}
                    style={{ transitionDelay: `${i * 120}ms` }}
                    className={`grid grid-cols-[2.75rem_minmax(0,1fr)] gap-3 py-7 ${fadeUp}`}
                  >
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-forest text-sm tabular-nums text-paper">
                      {i + 1}
                    </span>
                    <div>
                      <h3 className="font-serif text-2xl">{step.title}</h3>
                      <p className="mt-1.5 max-w-md text-sm leading-6 text-muted">{step.body}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </Reveal>
          </div>
        </section>

        <section className="border-t border-line bg-card">
          <div className="mx-auto max-w-6xl px-6 py-16">
            <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted">Under the hood</p>
            <h2 className="mt-3 max-w-xl font-serif text-2xl tracking-tight">
              Built in the open, and measured before it ships.
            </h2>
            <p className="mt-3 max-w-xl text-sm leading-6 text-muted">
              A LangGraph answer loop over your articles, a staff inbox you can also work from Claude over MCP, and an
              eval suite that runs on every pull request. The numbers below are from labeled questions in the repo.
            </p>
            <ul className="mt-8 grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
              {UNDER_THE_HOOD.map((item) => (
                <li key={item.stat} className="bg-paper">
                  <a href={item.href} className="group block h-full p-5 transition-colors hover:bg-card">
                    <span className="font-serif text-2xl tabular-nums">{item.stat}</span>
                    <span className="mt-1.5 block text-[13px] leading-5 text-muted group-hover:text-ink">
                      {item.label}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>

      <footer className="border-t border-line py-10">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 text-sm text-muted sm:flex-row sm:items-center sm:justify-between">
          <Brand />
          <div className="flex gap-6">
            <Link href="/demo" className="transition-colors hover:text-ink">
              Try the demo
            </Link>
            <Link href="/login" className="transition-colors hover:text-ink">
              Log in
            </Link>
            <a href={REPO} className="transition-colors hover:text-ink">
              GitHub
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
