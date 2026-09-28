"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ARTICLES } from "@/lib/articles";
import { IconChat, IconClose, IconDoc, IconPerson, IconSend } from "@/components/ui";

type ChatMessage = {
  id: string;
  role: "visitor" | "assistant" | "agent";
  body: string;
  citations: string[];
};

type ChatResponse = {
  conversationId: string;
  reply: string;
  citations: { slug: string; title: string }[];
  messages: ChatMessage[];
  ticketId?: string | null;
  escalated?: boolean;
};

const STORAGE_KEY = "relaydesk_conversation";
const OPEN_CHAT_EVENT = "nimbus:open-chat";

/** Open the widget from elsewhere on the page, e.g. a help article's "Still stuck?" button. */
export function openChat() {
  window.dispatchEvent(new Event(OPEN_CHAT_EVENT));
}

const SUGGESTIONS = [
  "Why does my invoice show extra seats?",
  "SSO loops back to Google.",
  "Where do I find API keys?",
];

function citationHref(title: string) {
  const article = ARTICLES.find((a) => a.title === title);
  return article ? `/help/${article.slug}` : "/help";
}

export function Widget() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [email, setEmail] = useState("");
  const conversationId = useRef<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ticketId, setTicketId] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (!saved) return;
    conversationId.current = saved;
    fetch(`/api/chat?conversationId=${encodeURIComponent(saved)}`)
      .then(async (res) => {
        if (res.status === 404) {
          window.localStorage.removeItem(STORAGE_KEY);
          conversationId.current = null;
          return;
        }
        if (!res.ok) return;
        const data = (await res.json()) as ChatResponse & { ticketId?: string | null };
        setMessages(
          (data.messages ?? []).map((m) => ({
            ...m,
            citations: m.citations ?? [],
          })),
        );
        if (data.ticketId) setTicketId(data.ticketId);
      })
      .catch(() => {
        /* keep a blank thread; the next send will reuse or recreate */
      });
  }, []);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(OPEN_CHAT_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_CHAT_EVENT, onOpen);
  }, []);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    bottom.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth" });
  }, [messages, pending, open]);

  async function sendText(text: string) {
    if (!text || pending) return;
    setInput("");
    setError(null);
    setPending(true);
    setMessages((prev) => [
      ...prev,
      { id: `local-${Date.now()}`, role: "visitor", body: text, citations: [] },
    ]);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: conversationId.current,
          message: text,
        }),
      });
      const data = (await res.json()) as ChatResponse & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Chat failed");
      conversationId.current = data.conversationId;
      window.localStorage.setItem(STORAGE_KEY, data.conversationId);
      if (data.ticketId) setTicketId(data.ticketId);
      setMessages(
        data.messages.map((m) => ({
          ...m,
          citations: m.citations ?? [],
        })),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chat failed");
    } finally {
      setPending(false);
    }
  }

  async function send(event?: React.FormEvent) {
    event?.preventDefault();
    await sendText(input.trim());
  }

  async function saveEmail(event: React.FormEvent) {
    event.preventDefault();
    if (!conversationId.current || !email.includes("@")) return;
    setError(null);
    const res = await fetch("/api/tickets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId: conversationId.current, email }),
    });
    const data = (await res.json()) as { ticket?: { id: string }; error?: string };
    if (!res.ok) {
      setError(data.error ?? "Could not update ticket");
      return;
    }
    if (data.ticket?.id) setTicketId(data.ticket.id);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`fixed bottom-5 right-5 z-40 h-14 w-14 items-center justify-center rounded-full bg-forest text-paper shadow-lift transition hover:bg-forest-2 active:scale-[0.97] ${open ? "hidden sm:flex" : "flex"}`}
        aria-expanded={open}
        aria-label={open ? "Close chat" : "Ask Nimbus"}
      >
        {open ? <IconClose /> : <IconChat />}
      </button>
      {open ? (
        <div
          role="region"
          aria-label="Nimbus support chat"
          className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-card motion-safe:animate-rise sm:inset-auto sm:bottom-24 sm:right-5 sm:h-[min(36rem,76vh)] sm:w-[23rem] sm:origin-bottom-right sm:rounded-2xl sm:border sm:border-line sm:shadow-float"
        >
          <div data-surface="dark" className="flex items-center gap-3 bg-forest px-4 py-3.5 text-paper">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-paper/15">
              <span className="h-2.5 w-2.5 rounded-full bg-paper" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">Nimbus support</p>
              <p className="flex items-center gap-1.5 text-xs text-paper/70">
                <span className="h-1.5 w-1.5 rounded-full bg-[#9fdbb6]" />
                Answers from the help center
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close chat"
              className="flex h-9 w-9 items-center justify-center rounded-full text-paper/80 transition hover:bg-paper/10 hover:text-paper sm:hidden"
            >
              <IconClose className="h-4 w-4" />
            </button>
          </div>
          <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
            {messages.length === 0 ? (
              <div className="pt-1">
                <p className="font-serif text-2xl leading-tight">How can we help?</p>
                <p className="mt-1.5 text-sm leading-6 text-muted">
                  Answers come from the Nimbus help center, with the article they came from.
                </p>
                <p className="mt-5 text-[11px] font-medium uppercase tracking-widest text-muted">
                  Try asking
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {SUGGESTIONS.map((text) => (
                    <button
                      key={text}
                      type="button"
                      onClick={() => void sendText(text)}
                      className="rounded-full border border-line bg-paper px-3 py-1.5 text-left text-sm transition hover:border-forest/40 hover:bg-forest/5 active:scale-[0.98]"
                    >
                      {text}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {messages.map((message) => {
              if (message.role === "visitor") {
                return (
                  <div key={message.id} className="ml-10 flex justify-end">
                    <p className="whitespace-pre-wrap rounded-2xl rounded-br-md bg-forest px-3.5 py-2 text-sm leading-5 text-paper">
                      {message.body}
                    </p>
                  </div>
                );
              }
              const staff = message.role === "agent";
              // The top hit is the article the answer quotes; the others are retrieval runners-up.
              const source = message.citations[0];
              return (
                <div key={message.id} className="mr-8">
                  <p className={`mb-1 text-[11px] font-medium ${staff ? "text-copper" : "text-muted"}`}>
                    {staff ? "Staff" : "Nimbus bot"}
                  </p>
                  <div
                    className={
                      staff
                        ? "rounded-2xl rounded-tl-md border border-copper/25 bg-copper/5 px-3.5 py-2.5"
                        : "rounded-2xl rounded-tl-md bg-paper px-3.5 py-2.5"
                    }
                  >
                    <p className="whitespace-pre-wrap text-sm leading-6">{message.body}</p>
                  </div>
                  {source ? (
                    <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
                      Answer based on
                      <Link
                        href={citationHref(source)}
                        className="inline-flex items-center gap-1 rounded-md border border-line bg-card px-1.5 py-0.5 text-ink transition hover:border-forest/40 hover:text-forest"
                      >
                        <IconDoc className="h-3 w-3" />
                        {source}
                      </Link>
                    </p>
                  ) : null}
                </div>
              );
            })}
            {pending ? (
              <div role="status" className="mr-8">
                <p className="mb-1 text-[11px] font-medium text-muted">Nimbus bot</p>
                <div className="inline-flex items-center gap-1 rounded-2xl rounded-tl-md bg-paper px-3.5 py-3">
                  {["[animation-delay:0ms]", "[animation-delay:150ms]", "[animation-delay:300ms]"].map((delay) => (
                    <span key={delay} className={`h-1.5 w-1.5 rounded-full bg-muted motion-safe:animate-typing ${delay}`} />
                  ))}
                  <span className="sr-only">Looking through help…</span>
                </div>
              </div>
            ) : null}
            <div ref={bottom} />
          </div>
          {ticketId ? (
            <div className="border-t border-line bg-forest/5 px-4 py-3">
              <p className="text-xs leading-5">
                Ticket <span className="font-mono">{ticketId}</span> is in the{" "}
                <Link href="/inbox" className="text-forest underline underline-offset-2">
                  staff inbox
                </Link>
                . Leave an email for the reply.
              </p>
              <form onSubmit={saveEmail} className="mt-2 flex gap-2">
                <input
                  type="email"
                  aria-label="Email for the reply"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  className="min-w-0 flex-1 rounded-md border border-line bg-card px-2.5 py-1.5 text-xs outline-none ring-forest/20 focus:ring-2"
                />
                <button
                  type="submit"
                  className="shrink-0 rounded-md bg-forest px-2.5 py-1.5 text-xs text-paper transition hover:bg-forest-2 active:scale-[0.98]"
                >
                  Save
                </button>
              </form>
            </div>
          ) : null}
          {error ? (
            <p role="alert" className="border-t border-line px-4 py-2 text-xs text-copper">
              {error}
            </p>
          ) : null}
          <form onSubmit={send} className="border-t border-line p-3">
            <div className="flex items-center gap-2">
              <input
                aria-label="Message"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Type a message"
                className="flex-1 rounded-xl border border-line bg-paper px-3.5 py-2.5 text-sm outline-none ring-forest/20 transition focus:border-forest/40 focus:ring-2"
              />
              <button
                type="submit"
                disabled={pending}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-forest text-paper transition hover:bg-forest-2 active:scale-[0.97] disabled:opacity-50"
                aria-label="Send"
              >
                <IconSend />
              </button>
            </div>
            {messages.length > 0 && !ticketId ? (
              <button
                type="button"
                onClick={() => void sendText("This didn't help")}
                className="mt-2 inline-flex items-center gap-1.5 text-xs text-muted transition hover:text-ink"
              >
                <IconPerson />
                This didn&apos;t help
              </button>
            ) : null}
          </form>
        </div>
      ) : null}
    </>
  );
}
