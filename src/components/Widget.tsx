"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

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
};

const STORAGE_KEY = "relaydesk_conversation";

export function Widget() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [email, setEmail] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ticketId, setTicketId] = useState<string | null>(null);
  const [showEscalate, setShowEscalate] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (!saved) return;
    setConversationId(saved);
    fetch(`/api/chat?conversationId=${encodeURIComponent(saved)}`)
      .then(async (res) => {
        if (res.status === 404) {
          window.localStorage.removeItem(STORAGE_KEY);
          setConversationId(null);
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

  async function send(event?: React.FormEvent) {
    event?.preventDefault();
    const text = input.trim();
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
        body: JSON.stringify({ conversationId, message: text }),
      });
      const data = (await res.json()) as ChatResponse & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Chat failed");
      setConversationId(data.conversationId);
      window.localStorage.setItem(STORAGE_KEY, data.conversationId);
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

  async function escalate(event: React.FormEvent) {
    event.preventDefault();
    if (!conversationId) return;
    setError(null);
    const res = await fetch("/api/tickets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId, email }),
    });
    const data = (await res.json()) as { ticket?: { id: string }; error?: string };
    if (!res.ok) {
      setError(data.error ?? "Could not create ticket");
      return;
    }
    setTicketId(data.ticket?.id ?? null);
    setShowEscalate(false);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-5 right-5 z-40 flex h-12 items-center gap-2 rounded-full bg-forest px-4 text-sm text-paper shadow-lg transition-transform active:scale-[0.97]"
        aria-expanded={open}
      >
        {open ? "Close" : "Ask Nimbus"}
      </button>
      {open ? (
        <div className="fixed bottom-20 right-5 z-40 flex h-[min(32rem,70vh)] w-[min(22rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-line bg-card shadow-2xl">
          <div className="border-b border-line px-4 py-3">
            <p className="text-sm font-medium">Nimbus support</p>
            <p className="text-xs text-muted">Answers from the help center. A person if that fails.</p>
          </div>
          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {messages.length === 0 ? (
              <p className="text-sm text-muted">
                Try “Why does my invoice show extra seats?” or “SSO loops back to Google.”
              </p>
            ) : null}
            {messages.map((message) => (
              <div
                key={message.id}
                className={
                  message.role === "visitor"
                    ? "ml-8 rounded-2xl bg-forest px-3 py-2 text-sm text-paper"
                    : "mr-4 rounded-2xl bg-paper px-3 py-2 text-sm"
                }
              >
                {message.role === "agent" ? (
                  <p className="mb-1 text-[10px] uppercase tracking-widest text-copper">Staff</p>
                ) : null}
                <p className="whitespace-pre-wrap leading-5">{message.body}</p>
                {message.citations.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {message.citations.map((title) => (
                      <span
                        key={title}
                        className="rounded-full border border-line px-2 py-0.5 text-[10px] text-muted"
                      >
                        {title}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
            {pending ? <p className="text-xs text-muted">Looking through help…</p> : null}
            <div ref={bottom} />
          </div>
          {ticketId ? (
            <p className="border-t border-line px-4 py-2 text-xs text-muted">
              Ticket {ticketId} is in the{" "}
              <Link href="/inbox" className="text-forest underline">
                staff inbox
              </Link>
              .
            </p>
          ) : null}
          {showEscalate && !ticketId ? (
            <form onSubmit={escalate} className="border-t border-line px-4 py-3">
              <p className="text-xs text-muted">We’ll open a ticket with this transcript.</p>
              <input
                required
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                className="mt-2 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm outline-none"
              />
              <button
                type="submit"
                className="mt-2 w-full rounded-lg bg-copper py-2 text-sm text-paper"
              >
                Send to a person
              </button>
            </form>
          ) : null}
          {error ? <p className="px-4 text-xs text-copper">{error}</p> : null}
          <form onSubmit={send} className="border-t border-line p-3">
            <div className="flex gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask about billing, SSO, keys…"
                className="flex-1 rounded-lg border border-line bg-paper px-3 py-2 text-sm outline-none"
              />
              <button
                type="submit"
                disabled={pending}
                className="rounded-lg bg-forest px-3 text-sm text-paper disabled:opacity-50"
              >
                Send
              </button>
            </div>
            {messages.length > 0 && !ticketId ? (
              <button
                type="button"
                onClick={() => setShowEscalate(true)}
                className="mt-2 text-xs text-muted underline"
              >
                This didn’t help
              </button>
            ) : null}
          </form>
        </div>
      ) : null}
    </>
  );
}
