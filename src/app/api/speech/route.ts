import { NextResponse } from "next/server";
import { loadLiveHelpCenter } from "@/lib/business";
import { getConversation, listMessages } from "@/lib/db";
import { allowPlay, elevenLabsConfig, speechRequest } from "@/lib/elevenlabs";
import { recordVoiceSeconds, speakingSeconds, voiceStatus } from "@/lib/server-voice";
import { spokenText } from "@/lib/voice";

/*
 * Reads one of the bot's answers aloud with ElevenLabs. It only speaks a stored
 * assistant message from a conversation in that business, never text the
 * caller sends, so the key can't be borrowed as a free TTS service, and only
 * while the business has ElevenLabs on and minutes left.
 * GET, so the widget's <audio> element can stream it straight from the URL.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const business = params.get("business")?.trim();
  const conversationId = params.get("conversationId")?.trim();
  const messageId = params.get("messageId")?.trim();
  const center = business ? loadLiveHelpCenter(business) : undefined;
  if (!center) return NextResponse.json({ error: "business not found" }, { status: 404 });
  const config = elevenLabsConfig();
  if (voiceStatus(center.businessId).provider !== "elevenlabs" || !config) {
    // Off, or out of minutes: the widget reads the answer with the browser's voice.
    return NextResponse.json({ error: "voice unavailable" }, { status: 409 });
  }
  if (!conversationId || !messageId || !getConversation(center.businessId, conversationId)) {
    return NextResponse.json({ error: "conversation not found" }, { status: 404 });
  }
  const message = listMessages(conversationId).find((m) => m.id === messageId && m.role === "assistant");
  if (!message) return NextResponse.json({ error: "message not found" }, { status: 404 });
  if (!allowPlay(message.id)) return NextResponse.json({ error: "already played" }, { status: 429 });

  const text = spokenText(message.body);
  const { url, init } = speechRequest(config, text);
  const upstream = await fetch(url, { ...init, signal: request.signal }).catch(() => null);
  if (!upstream?.ok || !upstream.body) {
    // The widget falls back to the browser's voice on any error.
    return NextResponse.json({ error: "speech failed" }, { status: 502 });
  }
  recordVoiceSeconds(center.businessId, speakingSeconds(text));
  return new Response(upstream.body, {
    headers: { "Content-Type": "audio/mpeg", "Cache-Control": "private, no-store" },
  });
}
