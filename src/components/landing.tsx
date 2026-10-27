"use client";

import { useEffect, useRef, useState } from "react";

const EASE = "ease-[cubic-bezier(0.22,1,0.36,1)]";

function reducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** True once the element has scrolled into view. Never flips back, so motion runs once. */
function useSeen<T extends Element>() {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setSeen(true);
          io.disconnect();
        }
      },
      { threshold: 0.35 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return [ref, seen] as const;
}

/** Fades and lifts its children in when they scroll into view. Children can use `group-data-seen:`. */
export function Reveal({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const [ref, seen] = useSeen<HTMLDivElement>();
  return (
    <div ref={ref} data-seen={seen || undefined} className={`group ${className}`}>
      {children}
    </div>
  );
}

/** A headline whose lines slide up out of a mask, one after another. */
export function RevealHeadline({ lines, className = "" }: { lines: React.ReactNode[]; className?: string }) {
  const [ref, seen] = useSeen<HTMLHeadingElement>();
  return (
    <h1 ref={ref} data-seen={seen || undefined} className={`group ${className}`}>
      {lines.map((line, i) => (
        <span key={i} className="block overflow-hidden pb-[0.08em]">
          <span
            style={{ transitionDelay: `${100 + i * 90}ms` }}
            className={`inline-block translate-y-[105%] transition-transform duration-700 ${EASE} group-data-seen:translate-y-0`}
          >
            {line}
          </span>
        </span>
      ))}
    </h1>
  );
}

type Line = { from: "customer" | "bot"; text: React.ReactNode; source?: string };

const CHAT: Line[] = [
  { from: "customer", text: "Hi po! Pwede ba i-move yung cleaning ko bukas sa Saturday?" },
  {
    from: "bot",
    text: (
      <>
        Yes. You can reschedule up to 24 hours before your appointment from{" "}
        <b className="font-medium">My Bookings → Reschedule</b>.
      </>
    ),
    source: "Rescheduling an appointment",
  },
  { from: "customer", text: "May discount ba kung buong pamilya kami, 5 kami?" },
  {
    from: "bot",
    text: "Our help articles don't cover group discounts, so I've passed this to the team. They'll email you.",
  },
];

const TRANSCRIPT =
  "Example conversation. Customer: Hi po! Pwede ba i-move yung cleaning ko bukas sa Saturday? " +
  "Assistant: Yes. You can reschedule up to 24 hours before your appointment from My Bookings, Reschedule. Source: Rescheduling an appointment. " +
  "Customer: May discount ba kung buong pamilya kami, 5 kami? " +
  "Assistant: Our help articles don't cover group discounts, so I've passed this to the team. They'll email you. " +
  "A new ticket, Group discount for 5, lands in the staff inbox.";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The hero's scripted widget conversation. It plays once, when it scrolls into view. */
export function HeroChat() {
  const [ref, seen] = useSeen<HTMLDivElement>();
  const [shown, setShown] = useState(0);
  const [typing, setTyping] = useState(false);
  const [ticket, setTicket] = useState(false);

  useEffect(() => {
    if (!seen) return;
    // Reduced motion: same steps, no pauses, so the finished conversation shows at once.
    const pause = reducedMotion() ? () => wait(0) : wait;
    let live = true;
    (async () => {
      await pause(500);
      for (let i = 0; i < CHAT.length && live; i++) {
        if (CHAT[i].from === "bot") {
          setTyping(true);
          await pause(900);
          if (!live) return;
          setTyping(false);
        }
        setShown(i + 1);
        await pause(CHAT[i].from === "bot" ? 1200 : 650);
      }
      if (live) setTicket(true);
    })();
    return () => {
      live = false;
    };
  }, [seen]);

  return (
    <div ref={ref} className="relative">
      <p className="sr-only">{TRANSCRIPT}</p>
      <div
        aria-hidden
        className="flex min-h-[22rem] flex-col gap-2 overflow-hidden rounded-2xl border border-line bg-card p-4 shadow-float"
      >
        <div className="flex items-center gap-2 border-b border-line pb-2.5 text-xs text-muted">
          <span className="h-1.5 w-1.5 rounded-full bg-[#3c9a6e]" />
          Luma Dental · usually answers instantly
        </div>
        {CHAT.slice(0, shown).map((line, i) => (
          <div
            key={i}
            className={`max-w-[86%] animate-rise rounded-2xl px-3 py-2 text-[13px] leading-snug ${
              line.from === "customer"
                ? "self-end rounded-br-sm bg-forest text-paper"
                : "self-start rounded-bl-sm border border-line bg-white"
            }`}
          >
            {line.text}
            {line.source && (
              <span className="mt-1.5 block text-[11.5px] text-forest-2 underline underline-offset-2">
                {line.source}
              </span>
            )}
          </div>
        ))}
        {typing && (
          <div className="flex gap-1 self-start rounded-2xl border border-line bg-white px-3 py-2.5">
            {[0, 150, 300].map((d) => (
              <span
                key={d}
                style={{ animationDelay: `${d}ms` }}
                className="h-1.5 w-1.5 animate-typing rounded-full bg-muted"
              />
            ))}
          </div>
        )}
        <div
          className={`mt-auto flex items-center gap-3 rounded-xl bg-ink px-3.5 py-3 text-[12.5px] text-paper transition duration-500 ease-[cubic-bezier(0.34,1.4,0.64,1)] ${
            ticket ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0"
          }`}
        >
          <span className="shrink-0 rounded-full bg-copper px-2 py-0.5 text-[11px] font-medium">New ticket</span>
          <span>
            Group discount for 5
            <small className="block text-[11.5px] text-[#b9b2a5]">In your inbox · customer email attached</small>
          </span>
        </div>
      </div>
    </div>
  );
}

const INBOX: { q: string; needsYou?: boolean }[] = [
  { q: "Magkano po yung cleaning?" },
  { q: "Open ba kayo ng Sunday?" },
  { q: "Paano mag-reschedule?" },
  { q: "Do you accept HMO?" },
  { q: "May parking ba?" },
  { q: "Pwede ba GCash?" },
  { q: "Masakit ngipin ko since last week, emergency ba?", needsYou: true },
  { q: "Group discount for 5?", needsYou: true },
];
const NEEDS_YOU = INBOX.filter((m) => m.needsYou).length;

/** "Without / with relaydesk" over the same morning's messages. Flips itself once, then it's the visitor's. */
export function InboxSwitch() {
  const [ref, seen] = useSeen<HTMLDivElement>();
  const [on, setOn] = useState(false);
  const [count, setCount] = useState(INBOX.length);
  const target = on ? NEEDS_YOU : INBOX.length;

  useEffect(() => {
    if (!seen) return;
    const t = setTimeout(() => setOn(true), 900);
    return () => clearTimeout(t);
  }, [seen]);

  useEffect(() => {
    if (count === target) return;
    const fast = reducedMotion();
    const t = setTimeout(() => setCount((c) => (fast ? target : c + (c < target ? 1 : -1))), fast ? 0 : 55);
    return () => clearTimeout(t);
  }, [count, target]);

  return (
    <div ref={ref}>
      <h2 className="font-serif text-4xl leading-[1.05] tracking-tight sm:text-5xl">
        <span className="text-copper">{INBOX.length}</span> new messages since lunch.
        <br />
        Only <span className="text-forest">{NEEDS_YOU}</span> need you.
      </h2>
      <p className="mt-4 max-w-lg leading-7 text-muted">
        Most of what customers ask is already in your FAQ. Relaydesk answers those on your website and leaves you
        the questions that need a person.
      </p>
      <div role="group" aria-label="Compare" className="relative mt-6 inline-flex rounded-full bg-[#e9e2d4] p-1 text-sm">
        <span
          aria-hidden
          className={`absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-full bg-card shadow-sm transition-transform duration-300 ${EASE} ${
            on ? "translate-x-full" : ""
          }`}
        />
        {[false, true].map((value) => (
          <button
            key={String(value)}
            type="button"
            aria-pressed={on === value}
            onClick={() => setOn(value)}
            className={`relative w-40 rounded-full py-1.5 font-medium transition-colors ${
              on === value ? "text-ink" : "text-muted hover:text-ink"
            }`}
          >
            {value ? "With Relaydesk" : "Without Relaydesk"}
          </button>
        ))}
      </div>
      <p className="mt-5 text-sm text-muted">
        Waiting on you: <span className="font-medium tabular-nums text-ink">{count}</span>
      </p>
      <ul className="mt-2 divide-y divide-line overflow-hidden rounded-xl border border-line bg-card">
        {INBOX.map((m, i) => {
          const state = !on ? "unread" : m.needsYou ? "you" : "done";
          return (
            <li
              key={m.q}
              style={{ transitionDelay: on ? `${i * 90}ms` : "0ms" }}
              className={`grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2.5 text-[13px] transition-[opacity,background-color] duration-300 ${
                state === "done" ? "opacity-50" : state === "you" ? "bg-[#f7e7dc]" : ""
              }`}
            >
              <span
                style={{ transitionDelay: on ? `${i * 90}ms` : "0ms" }}
                className={`flex h-[18px] w-[18px] items-center justify-center rounded-full border-[1.5px] transition-colors duration-300 ${
                  state === "done" ? "border-forest-2 bg-forest-2" : state === "you" ? "border-copper" : "border-line"
                }`}
              >
                {state === "done" && (
                  <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" aria-hidden>
                    <path d="M2 6.5l2.5 2.5L10 3" fill="none" stroke="#fff" strokeWidth="2.5" />
                  </svg>
                )}
              </span>
              <span className="truncate">{m.q}</span>
              <span className={`text-[11.5px] ${state === "you" ? "font-medium text-copper" : "text-muted"}`}>
                {state === "unread" ? "Unread" : state === "you" ? "Needs you" : "Answered from FAQ"}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
