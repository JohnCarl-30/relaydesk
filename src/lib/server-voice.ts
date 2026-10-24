import { addVoiceSeconds, getSetting, setSetting, voiceSecondsUsed } from "@/lib/db";
import { elevenLabsConfig } from "@/lib/elevenlabs";

/*
 * Whether a business's widget talks through ElevenLabs. Three things must hold:
 * the server has a key, the business switched it on in Setup, and it has
 * minutes left this month. Otherwise the widget uses the browser's own voice,
 * which costs nothing, so the cap can never leave a visitor without voice.
 */

export const VOICE_SETTING = "voice";
export type VoiceProvider = "browser" | "elevenlabs";

/** Monthly ElevenLabs minutes per business, speech in and out together. */
export const DEFAULT_VOICE_MINUTES = 300;

export function voiceMinutesCap(env: Record<string, string | undefined> = process.env): number {
  const raw = env.RELAYDESK_VOICE_MINUTES?.trim();
  const minutes = raw ? Number(raw) : NaN;
  return Number.isFinite(minutes) && minutes >= 0 ? minutes : DEFAULT_VOICE_MINUTES;
}

export type VoiceStatus = {
  /** The server has an ElevenLabs key. */
  configured: boolean;
  /** The business switched ElevenLabs on. */
  enabled: boolean;
  usedSeconds: number;
  capSeconds: number;
  /** What the widget uses right now. */
  provider: VoiceProvider;
};

export function voiceStatus(businessId: string): VoiceStatus {
  const configured = elevenLabsConfig() !== null;
  const enabled = getSetting(businessId, VOICE_SETTING) === "elevenlabs";
  const usedSeconds = voiceSecondsUsed(businessId);
  const capSeconds = voiceMinutesCap() * 60;
  const provider = configured && enabled && usedSeconds < capSeconds ? "elevenlabs" : "browser";
  return { configured, enabled, usedSeconds, capSeconds, provider };
}

export function setVoiceProvider(businessId: string, provider: VoiceProvider) {
  setSetting(businessId, VOICE_SETTING, provider);
}

export function recordVoiceSeconds(businessId: string, seconds: number) {
  addVoiceSeconds(businessId, seconds);
}

/**
 * Roughly how long a reply takes to say, at about 15 characters a second.
 * ElevenLabs bills speech out by character; this puts it in the same minutes as speech in.
 */
export function speakingSeconds(text: string): number {
  return Math.ceil(text.length / 15);
}

/** The longest question the widget records, and the biggest upload the server takes. */
export const MAX_QUESTION_SECONDS = 30;
export const MAX_QUESTION_BYTES = 2_000_000;
