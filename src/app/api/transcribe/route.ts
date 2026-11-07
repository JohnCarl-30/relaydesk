import { NextResponse } from "next/server";
import { loadLiveHelpCenter } from "@/lib/business";
import { elevenLabsConfig, readTranscript, transcribeRequest } from "@/lib/elevenlabs";
import { allowRequest, CHAT_PER_MINUTE, clientIp } from "@/lib/rate-limit";
import { MAX_QUESTION_BYTES, recordVoiceSeconds, voiceStatus } from "@/lib/server-voice";

/*
 * Turns one recorded question into text with ElevenLabs Scribe. The widget then
 * sends the text to /api/chat like any message, so the answer loop is unchanged.
 * Every second counts toward the business's monthly voice minutes.
 */
export async function POST(request: Request) {
  const business = new URL(request.url).searchParams.get("business")?.trim();
  const center = business ? loadLiveHelpCenter(business) : undefined;
  if (!center) return NextResponse.json({ error: "business not found" }, { status: 404 });
  const status = voiceStatus(center.businessId);
  const config = elevenLabsConfig();
  if (status.provider !== "elevenlabs" || !config) {
    // Off, or out of minutes: the widget switches to the browser's voice.
    return NextResponse.json({ error: "voice unavailable", provider: status.provider }, { status: 409 });
  }

  if (!allowRequest(`voice:${clientIp(request.headers)}`, CHAT_PER_MINUTE)) {
    return NextResponse.json({ error: "too many recordings" }, { status: 429, headers: { "Retry-After": "60" } });
  }

  // Without a length, blob() would read an unbounded body into memory before the size check below.
  const length = request.headers.get("content-length");
  if (length === null) return NextResponse.json({ error: "content-length required" }, { status: 411 });
  if (Number(length) > MAX_QUESTION_BYTES) return NextResponse.json({ error: "recording too long" }, { status: 413 });
  const audio = await request.blob().catch(() => null);
  if (!audio || audio.size === 0) return NextResponse.json({ error: "audio required" }, { status: 400 });
  if (audio.size > MAX_QUESTION_BYTES) return NextResponse.json({ error: "recording too long" }, { status: 413 });

  const type = request.headers.get("content-type") ?? "audio/webm";
  const extension = type.includes("mp4") ? "mp4" : type.includes("ogg") ? "ogg" : "webm";
  const { url, init } = transcribeRequest(config, new Blob([audio], { type }), `question.${extension}`);
  const upstream = await fetch(url, { ...init, signal: request.signal }).catch(() => null);
  if (!upstream?.ok) return NextResponse.json({ error: "transcription failed" }, { status: 502 });

  const { text, seconds } = readTranscript(await upstream.json().catch(() => null));
  // A silent clip has no words to time, but it was still sent and billed. Count all of it: ElevenLabs bills all of it.
  recordVoiceSeconds(center.businessId, seconds || 1);
  return NextResponse.json({ text });
}
