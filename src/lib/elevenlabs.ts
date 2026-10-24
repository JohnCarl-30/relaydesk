/*
 * ElevenLabs text-to-speech for the widget's spoken answers. Optional: without
 * ELEVENLABS_API_KEY the widget reads answers with the browser's own voice.
 * The key stays on the server; the widget only ever fetches /api/speech.
 */

/** A calm premade voice ("Rachel"). Any voice id from the ElevenLabs voice library works. */
export const DEFAULT_VOICE_ID = "21m00Tcm4TlvDqDCyKwW";
/** Fast, low-cost and multilingual, so en-PH and Filipino answers sound right too. */
export const DEFAULT_MODEL_ID = "eleven_flash_v2_5";

export type ElevenLabsConfig = { apiKey: string; voiceId: string; modelId: string; baseUrl: string };

export function elevenLabsConfig(env: Record<string, string | undefined> = process.env): ElevenLabsConfig | null {
  const apiKey = env.ELEVENLABS_API_KEY?.trim();
  if (!apiKey) return null;
  return {
    apiKey,
    voiceId: env.ELEVENLABS_VOICE_ID?.trim() || DEFAULT_VOICE_ID,
    modelId: env.ELEVENLABS_MODEL?.trim() || DEFAULT_MODEL_ID,
    baseUrl: (env.ELEVENLABS_BASE_URL?.trim() || "https://api.elevenlabs.io").replace(/\/+$/, ""),
  };
}

/** The streaming TTS call. MP3 at 44.1 kHz/64 kbps plays everywhere and is small enough to start at once. */
export function speechRequest(config: ElevenLabsConfig, text: string): { url: string; init: RequestInit } {
  return {
    url: `${config.baseUrl}/v1/text-to-speech/${encodeURIComponent(config.voiceId)}/stream?output_format=mp3_44100_64`,
    init: {
      method: "POST",
      headers: { "xi-api-key": config.apiKey, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({ text, model_id: config.modelId }),
    },
  };
}

/**
 * Each answer is synthesized at most this many times, so a leaked conversation
 * id can't be replayed to run up the ElevenLabs bill. The widget asks once.
 */
export const PLAYS_PER_MESSAGE = 2;
const plays = new Map<string, number>();
const REMEMBERED = 5_000;

/** Counts a play of a message and says whether it is still allowed. In-process, which suits one server. */
export function allowPlay(messageId: string): boolean {
  const count = plays.get(messageId) ?? 0;
  if (count >= PLAYS_PER_MESSAGE) return false;
  plays.delete(messageId);
  plays.set(messageId, count + 1);
  // Maps iterate in insertion order, so the first key is the least recently played.
  if (plays.size > REMEMBERED) plays.delete(plays.keys().next().value!);
  return true;
}

/** ElevenLabs' current speech-to-text model. It detects the language, Tagalog and Taglish included. */
export const TRANSCRIBE_MODEL_ID = "scribe_v2";

/** The batch speech-to-text call, for one recorded question. */
export function transcribeRequest(config: ElevenLabsConfig, audio: Blob, filename = "question.webm"): { url: string; init: RequestInit } {
  const form = new FormData();
  form.append("model_id", TRANSCRIBE_MODEL_ID);
  form.append("file", audio, filename);
  // Laughter and coughs as "(laughs)" would only confuse the answer loop.
  form.append("tag_audio_events", "false");
  return {
    url: `${config.baseUrl}/v1/speech-to-text`,
    init: { method: "POST", headers: { "xi-api-key": config.apiKey }, body: form },
  };
}

type Transcript = { text?: unknown; words?: { end?: unknown }[] };

/** The question as heard, and how many seconds of audio it took, from a speech-to-text response. */
export function readTranscript(json: unknown): { text: string; seconds: number } {
  const transcript = (json ?? {}) as Transcript;
  const text = typeof transcript.text === "string" ? transcript.text.trim() : "";
  const ends = (transcript.words ?? []).map((w) => (typeof w.end === "number" ? w.end : 0));
  return { text, seconds: ends.length ? Math.max(...ends) : 0 };
}
