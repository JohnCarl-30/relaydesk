"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ARTICLES } from "@/lib/articles";
import { IconChat, IconSend } from "@/components/ui";

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
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, open]);

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
        className="fixed bottom-5 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-forest text-paper shadow-lg transition-transform active:scale-[0.97]"
        aria-expanded={open}
        aria-label={open ? "Close chat" : "Ask Nimbus"}
      >
        {open ? (
          <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5" aria-hidden>
            <path d="M5 5l10 10M15 5 5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        ) : (
          <IconChat />
        )}
      </button>
      {open ? (
        <div className="fixed bottom-24 right-5 z-40 flex h-[min(34rem,72vh)] w-[min(22.5rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-line bg-card shadow-2xl">
          <div className="bg-forest px-4 py-3.5 text-paper">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-paper/15 text-sm">
                N
              </span>
              <div>
                <p className="text-sm font-medium">Nimbus support</p>
                <p className="flex items-center gap-1.5 text-xs text-paper/70">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#9fdbb6]" />
                  Answers from the help center
                </p>
              </div>
            </div>
          </div>
          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {messages.length === 0 ? (
              <div>
                <p className="text-sm leading-6">
                  Ask about seats, SSO, or API keys.
                </p>
                <div className="mt-4 flex flex-col gap-2">
                  {SUGGESTIONS.map((text) => (
                    <button
                      key={text}
                      type="button"
                      onClick={() => void sendText(text)}
                      className="rounded-lg border border-line bg-paper px-3 py-2 text-left text-sm hover:border-forest/30"
                    >
                      {text}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {messages.map((message) => (
              <div
                key={message.id}
                className={
                  message.role === "visitor"
                    ? "ml-8 rounded-2xl rounded-br-sm bg-forest px-3 py-2 text-sm text-paper"
                    : "mr-6 rounded-2xl rounded-bl-sm bg-paper px-3 py-2 text-sm"
                }
              >
                {message.role === "agent" ? (
                  <p className="mb-1 text-[10px] uppercase tracking-widest text-copper">Staff</p>
                ) : null}
                <p className="whitespace-pre-wrap leading-5">{message.body}</p>
                {message.citations.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {message.citations.map((title) => (
                      <Link
                        key={title}
                        href={citationHref(title)}
                        className="rounded-md border border-line bg-card px-2 py-0.5 text-[11px] text-muted hover:text-forest"
                      >
                        {title}
                      </Link>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
            {pending ? <p className="text-xs text-muted">Looking through help…</p> : null}
            <div ref={bottom} />
          </div>
          {ticketId ? (
            <div className="border-t border-line px-4 py-2">
              <p className="text-xs text-muted">
                Ticket {ticketId} is in the{" "}
                <Link href="/inbox" className="text-forest underline">
                  staff inbox
                </Link>
                .
              </p>
              <form onSubmit={saveEmail} className="mt-2 flex gap-2">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  className="min-w-0 flex-1 rounded-md border border-line bg-paper px-2 py-1 text-xs outline-none"
                />
                <button type="submit" className="shrink-0 text-xs text-forest">
                  Save
                </button>
              </form>
            </div>
          ) : null}
          {error ? <p className="px-4 text-xs text-copper">{error}</p> : null}
          <form onSubmit={send} className="border-t border-line p-3">
            <div className="flex items-end gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Type a message"
                className="flex-1 rounded-lg border border-line bg-paper px-3 py-2 text-sm outline-none"
              />
              <button
                type="submit"
                disabled={pending}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-forest text-paper disabled:opacity-50"
                aria-label="Send"
              >
                <IconSend />
              </button>
            </div>
            {messages.length > 0 && !ticketId ? (
              <button
                type="button"
                onClick={() => void sendText("This didn't help")}
                className="mt-2 text-xs text-muted hover:text-ink"
              >
                This didn&apos;t help
              </button>
            ) : null}
          </form>
        </div>
      ) : null}
    </>
  );
}
