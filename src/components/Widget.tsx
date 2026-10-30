"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { IconChat, IconClose, IconDoc, IconMic, IconPerson, IconSend, IconStop } from "@/components/ui";
import { useVoice } from "@/components/useVoice";
import { spokenText, type Channel } from "@/lib/voice";

/** An article the answer cites; slug is null when the article was renamed or removed since. */
type Citation = { title: string; slug: string | null };

type ChatMessage = {
  id: string;
  role: "visitor" | "assistant" | "agent";
  body: string;
  citations: Citation[];
};

type ChatResponse = {
  conversationId: string;
  reply: string;
  citations: { slug: string; title: string }[];
  messages: ChatMessage[];
  ticketId?: string | null;
  escalated?: boolean;
};

const OPEN_CHAT_EVENT = "relaydesk:open-chat";
/** Posted to the host page when the embedded widget opens or closes, so embed.js can resize the iframe. */
export const EMBED_RESIZE_MESSAGE = "relaydesk:widget";

/** Open the widget from elsewhere on the page, e.g. a help article's "Still stuck?" button. */
export function openChat() {
  window.dispatchEvent(new Event(OPEN_CHAT_EVENT));
}

export type WidgetProps = {
  business: { id: string; name: string };
  /** Where cited articles live, e.g. "/help" on the Nimbus site or "/h/acme" elsewhere. */
  helpBase: string;
  /** Starter questions on an empty thread. */
  suggestions?: string[];
  /** The demo links visitors to the staff inbox; a real business's widget does not. */
  showInboxLink?: boolean;
  /** Inside the embed iframe: links open in a new tab and open/close is posted to the host page. */
  embedded?: boolean;
  /** Language for speech in and out, e.g. "en-PH" or "fil-PH". */
  voiceLang?: string;
};

export function Widget({
  business,
  helpBase,
  suggestions = [],
  showInboxLink = false,
  embedded = false,
  voiceLang = "en-US",
}: WidgetProps) {
  // One saved conversation per business, so two widgets on one origin never share a thread.
  const storageKey = `relaydesk_conversation:${business.id}`;
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [email, setEmail] = useState("");
  const conversationId = useRef<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ticketId, setTicketId] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  // True when this business talks through ElevenLabs; asked of /api/voice each time the widget opens.
  const [serverVoice, setServerVoice] = useState(false);
  const voice = useVoice({
    lang: voiceLang,
    onError: setError,
    server: serverVoice ? { business: business.id, onUnavailable: () => setServerVoice(false) } : null,
  });
  // The question is being heard or transcribed, so the box shows it rather than what was typed.
  const hearing = voice.state === "listening" || voice.state === "transcribing";

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch(`/api/voice?business=${encodeURIComponent(business.id)}`)
      .then((res) => (res.ok ? (res.json() as Promise<{ provider?: string }>) : null))
      .then((data) => {
        if (!cancelled) setServerVoice(data?.provider === "elevenlabs");
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open, business.id]);

  useEffect(() => {
    const saved = window.localStorage.getItem(storageKey);
    if (!saved) return;
    conversationId.current = saved;
    const query = new URLSearchParams({ business: business.id, conversationId: saved });
    fetch(`/api/chat?${query}`)
      .then(async (res) => {
        if (res.status === 404) {
          window.localStorage.removeItem(storageKey);
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
  }, [business.id, storageKey]);

  // Staff answer tickets from /inbox, so check for their reply while the chat is open.
  useEffect(() => {
    if (!open || !ticketId || pending) return;
    let cancelled = false;
    const timer = window.setInterval(() => {
      if (!conversationId.current) return;
      const query = new URLSearchParams({ business: business.id, conversationId: conversationId.current });
      fetch(`/api/chat?${query}`)
        .then((res) => (res.ok ? (res.json() as Promise<{ messages?: ChatMessage[] }>) : null))
        .then((data) => {
          const fresh = data?.messages;
          if (cancelled || !fresh) return;
          // Same length means nothing new; keeping prev avoids a scroll jump every poll.
          setMessages((prev) =>
            fresh.length === prev.length ? prev : fresh.map((m) => ({ ...m, citations: m.citations ?? [] })),
          );
        })
        .catch(() => {});
    }, 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [open, ticketId, pending, business.id]);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(OPEN_CHAT_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_CHAT_EVENT, onOpen);
  }, []);

  useEffect(() => {
    if (!embedded || window.parent === window) return;
    window.parent.postMessage({ type: EMBED_RESIZE_MESSAGE, open }, "*");
  }, [embedded, open]);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    bottom.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth" });
  }, [messages, pending, open]);

  async function sendText(text: string, channel: Channel = "text") {
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
          business: business.id,
          conversationId: conversationId.current,
          message: text,
          channel,
        }),
      });
      const data = (await res.json()) as ChatResponse & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Chat failed");
      conversationId.current = data.conversationId;
      window.localStorage.setItem(storageKey, data.conversationId);
      if (data.ticketId) setTicketId(data.ticketId);
      setMessages(
        data.messages.map((m) => ({
          ...m,
          citations: m.citations ?? [],
        })),
      );
      // A spoken question gets a spoken answer. Typed ones stay quiet.
      if (channel === "voice") voice.speak(spokenText(data.reply), serverVoice ? speechUrl(data) : undefined);
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

  function speechUrl(data: ChatResponse): string | undefined {
    const answer = data.messages.findLast((m) => m.role === "assistant");
    if (!answer) return undefined;
    const params = new URLSearchParams({ business: business.id, conversationId: data.conversationId, messageId: answer.id });
    return `/api/speech?${params}`;
  }

  function toggleVoice() {
    if (voice.state === "listening") {
      voice.stopListening();
      return;
    }
    setError(null);
    voice.listen((heard) => void sendText(heard, "voice"));
  }

  function close() {
    voice.stopAll();
    setOpen(false);
  }

  async function saveEmail(event: React.FormEvent) {
    event.preventDefault();
    if (!conversationId.current || !email.includes("@")) return;
    setError(null);
    const res = await fetch("/api/tickets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ business: business.id, conversationId: conversationId.current, email }),
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
        onClick={() => (open ? close() : setOpen(true))}
        className={`fixed bottom-5 right-5 z-40 h-14 w-14 items-center justify-center rounded-full bg-forest text-paper shadow-lift transition hover:bg-forest-2 active:scale-[0.97] ${open ? "hidden sm:flex" : "flex"}`}
        aria-expanded={open}
        aria-label={open ? "Close chat" : `Ask ${business.name}`}
      >
        {open ? <IconClose /> : <IconChat />}
      </button>
      {open ? (
        <div
          role="region"
          aria-label={`${business.name} support chat`}
          className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-card motion-safe:animate-rise sm:inset-auto sm:bottom-24 sm:right-5 sm:h-[min(36rem,76vh)] sm:w-[23rem] sm:origin-bottom-right sm:rounded-2xl sm:border sm:border-line sm:shadow-float"
        >
          <div data-surface="dark" className="flex items-center gap-3 bg-forest px-4 py-3.5 text-paper">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-paper/15">
              <span className="h-2.5 w-2.5 rounded-full bg-paper" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{business.name} support</p>
              <p className="flex items-center gap-1.5 text-xs text-paper/70">
                <span className="h-1.5 w-1.5 rounded-full bg-[#9fdbb6]" />
                Answers from the help center
              </p>
            </div>
            <button
              type="button"
              onClick={close}
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
                  Answers come from the {business.name} help center, with the article they came from.
                </p>
                {suggestions.length > 0 ? (
                  <p className="mt-5 text-[11px] font-medium uppercase tracking-widest text-muted">
                    Try asking
                  </p>
                ) : null}
                <div className="mt-2 flex flex-wrap gap-2">
                  {suggestions.map((text) => (
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
                    {staff ? "Staff" : `${business.name} bot`}
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
                        href={source.slug ? `${helpBase}/${source.slug}` : helpBase}
                        target={embedded ? "_blank" : undefined}
                        className="inline-flex items-center gap-1 rounded-md border border-line bg-card px-1.5 py-0.5 text-ink transition hover:border-forest/40 hover:text-forest"
                      >
                        <IconDoc className="h-3 w-3" />
                        {source.title}
                      </Link>
                    </p>
                  ) : null}
                </div>
              );
            })}
            {pending ? (
              <div role="status" className="mr-8">
                <p className="mb-1 text-[11px] font-medium text-muted">{business.name} bot</p>
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
              {showInboxLink ? (
                <p className="text-xs leading-5">
                  Ticket <span className="font-mono">{ticketId}</span> is in the{" "}
                  <Link href="/inbox" className="text-forest underline underline-offset-2">
                    staff inbox
                  </Link>
                  . Leave an email for the reply.
                </p>
              ) : (
                <p className="text-xs leading-5">
                  A person from {business.name} will reply here. Leave an email for the reply.
                </p>
              )}
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
                value={hearing ? voice.interim : input}
                onChange={(e) => setInput(e.target.value)}
                readOnly={hearing}
                placeholder={voice.state === "listening" ? "Listening…" : voice.state === "transcribing" ? "Catching that…" : "Type a message"}
                className="flex-1 rounded-xl border border-line bg-paper px-3.5 py-2.5 text-sm outline-none ring-forest/20 transition focus:border-forest/40 focus:ring-2"
              />
              {voice.canListen ? (
                <button
                  type="button"
                  onClick={toggleVoice}
                  disabled={pending || voice.state === "transcribing"}
                  aria-pressed={voice.state === "listening"}
                  data-voice={voice.hearsWith}
                  aria-label={voice.state === "listening" ? "Stop listening" : "Ask by voice"}
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border transition active:scale-[0.97] disabled:opacity-50 ${
                    voice.state === "listening"
                      ? "border-copper bg-copper text-paper motion-safe:animate-pulse"
                      : "border-line bg-paper text-ink hover:border-forest/40 hover:text-forest"
                  }`}
                >
                  {voice.state === "listening" ? <IconStop /> : <IconMic />}
                </button>
              ) : null}
              <button
                type="submit"
                disabled={pending || hearing}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-forest text-paper transition hover:bg-forest-2 active:scale-[0.97] disabled:opacity-50"
                aria-label="Send"
              >
                <IconSend />
              </button>
            </div>
            <p aria-live="polite" className="sr-only">
              {voice.state === "listening"
                ? "Listening. Ask your question, then pause."
                : voice.state === "transcribing"
                  ? "Got it. Working out what you said."
                  : voice.state === "speaking"
                    ? "Reading the answer aloud."
                    : ""}
            </p>
            {voice.state === "speaking" ? (
              <button
                type="button"
                onClick={voice.stopSpeaking}
                className="mt-2 inline-flex items-center gap-1.5 text-xs text-muted transition hover:text-ink"
              >
                <IconStop className="h-3 w-3" />
                Stop reading aloud
              </button>
            ) : null}
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
