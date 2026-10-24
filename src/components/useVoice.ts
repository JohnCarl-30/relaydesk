"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { canRecord, microphoneErrorCode, recordQuestion, type Recording } from "@/components/recordQuestion";
import { recognitionErrorMessage } from "@/lib/voice";

/*
 * Push-to-talk on the browser's own speech services: SpeechRecognition turns
 * the visitor's question into text, speechSynthesis reads the answer back.
 * Chrome, Edge and Safari support recognition; Firefox does not, so the mic
 * stays hidden there. When the business has ElevenLabs on, the question is
 * recorded and transcribed at /api/transcribe instead (Firefox included), and
 * answers play from /api/speech, falling back to the browser's voice.
 */

type RecognitionResult = { isFinal: boolean; 0: { transcript: string } };
type RecognitionEvent = { resultIndex: number; results: ArrayLike<RecognitionResult> };
type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};
type RecognitionConstructor = new () => Recognition;

function recognitionConstructor(): RecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export type VoiceState = "idle" | "listening" | "transcribing" | "speaking";

/** Server-side speech for one business: where to send recordings, and what to do when it's unavailable. */
export type ServerVoice = {
  business: string;
  /** Called when the server says ElevenLabs is off or out of minutes, so the widget switches back. */
  onUnavailable: () => void;
};

/** Longest question recorded for the server. Matches MAX_QUESTION_SECONDS in server-voice.ts. */
const MAX_QUESTION_SECONDS = 30;

// Browser support never changes while the page is open, so there is nothing to subscribe to.
const noSubscription = () => () => {};

// An empty WAV. Playing it during the mic tap lets Safari play the answer later, outside the tap.
const SILENCE = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";

export function useVoice({
  lang,
  onError,
  server = null,
}: {
  lang: string;
  onError: (message: string) => void;
  /** Set when the business uses ElevenLabs; null for the browser's own voice. */
  server?: ServerVoice | null;
}) {
  // False on the server and during hydration, so both renders match; the real answer follows.
  const canRecognize = useSyncExternalStore(noSubscription, () => recognitionConstructor() !== null, () => false);
  const canRecordAudio = useSyncExternalStore(noSubscription, canRecord, () => false);
  const recordsForServer = server !== null && canRecordAudio;
  const canListen = canRecognize || recordsForServer;
  const canSpeak = useSyncExternalStore(noSubscription, () => "speechSynthesis" in window, () => false);
  const [state, setState] = useState<VoiceState>("idle");
  const [interim, setInterim] = useState("");
  const recognition = useRef<Recognition | null>(null);
  const recording = useRef<Recording | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const reportError = useRef(onError);
  useEffect(() => {
    reportError.current = onError;
  });

  const silence = useCallback(() => {
    const el = audio.current;
    if (el) {
      // Detach first: pausing must not count as a failed answer and trigger the fallback.
      el.onended = el.onerror = null;
      el.pause();
    }
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
  }, []);

  const stopSpeaking = useCallback(() => {
    silence();
    setState((current) => (current === "speaking" ? "idle" : current));
  }, [silence]);

  const stopListening = useCallback(() => {
    // stop() still delivers what was heard so far; abort() is for closing the widget.
    recognition.current?.stop();
    recording.current?.stop();
  }, []);

  const unlockAudio = useCallback(() => {
    // Still inside the visitor's tap, so this unlocks the element for the answer's audio.
    audio.current ??= new Audio();
    audio.current.src = SILENCE;
    audio.current.play().catch(() => {});
  }, []);

  /** Records the question and has the server transcribe it. */
  const listenWithServer = useCallback(
    async (voice: ServerVoice, onHeard: (text: string) => void) => {
      setState("listening");
      let rec: Recording;
      try {
        rec = await recordQuestion({ maxSeconds: MAX_QUESTION_SECONDS });
      } catch (err) {
        setState("idle");
        reportError.current(recognitionErrorMessage(microphoneErrorCode(err)) ?? "Voice input could not start.");
        return;
      }
      recording.current = rec;
      const result = await rec.done;
      recording.current = null;
      if (!result) return; // Aborted; stopAll already reset the state.
      if (!result.heard) {
        setState("idle");
        reportError.current(recognitionErrorMessage("no-speech")!);
        return;
      }

      setState("transcribing");
      try {
        const res = await fetch(`/api/transcribe?business=${encodeURIComponent(voice.business)}`, {
          method: "POST",
          headers: { "Content-Type": result.audio.type || "audio/webm" },
          body: result.audio,
        });
        if (res.status === 409) {
          // Switched off or out of minutes. The next tap uses the browser's recognizer, if it has one.
          voice.onUnavailable();
          throw new Error("unavailable");
        }
        if (!res.ok) throw new Error("transcription failed");
        const { text } = (await res.json()) as { text?: string };
        setState("idle");
        if (text?.trim()) onHeard(text.trim());
        else reportError.current(recognitionErrorMessage("no-speech")!);
      } catch {
        setState("idle");
        reportError.current("I couldn't hear that clearly. Tap the mic to try again, or type your question.");
      }
    },
    [],
  );

  /** Listens for one question. `onHeard` gets the final transcript once the visitor stops talking. */
  const listen = useCallback(
    (onHeard: (text: string) => void) => {
      if (recognition.current || recording.current) return;
      if (server && recordsForServer) {
        silence();
        unlockAudio();
        void listenWithServer(server, onHeard);
        return;
      }
      const Constructor = recognitionConstructor();
      if (!Constructor) return;
      // Talking over the bot interrupts it, the way it would on a call.
      silence();
      unlockAudio();

      const r = new Constructor();
      r.lang = lang;
      r.interimResults = true;
      r.continuous = false;
      r.maxAlternatives = 1;
      let heard = "";
      r.onresult = (event) => {
        let finalText = "";
        let pending = "";
        for (let i = 0; i < event.results.length; i++) {
          const result = event.results[i]!;
          if (result.isFinal) finalText += result[0].transcript;
          else pending += result[0].transcript;
        }
        heard = finalText.trim();
        setInterim(`${finalText}${pending}`.trim());
      };
      r.onerror = (event) => {
        const message = recognitionErrorMessage(event.error);
        if (message) reportError.current(message);
      };
      r.onend = () => {
        recognition.current = null;
        setInterim("");
        setState("idle");
        if (heard) onHeard(heard);
      };
      recognition.current = r;
      setState("listening");
      try {
        r.start();
      } catch {
        recognition.current = null;
        setState("idle");
        reportError.current("Voice input could not start. Type your question instead.");
      }
    },
    [lang, silence, unlockAudio, server, recordsForServer, listenWithServer],
  );

  const speakInBrowser = useCallback(
    (text: string) => {
      if (!text || typeof window === "undefined" || !("speechSynthesis" in window)) {
        setState((current) => (current === "speaking" ? "idle" : current));
        return;
      }
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = lang;
      utterance.onend = () => setState((current) => (current === "speaking" ? "idle" : current));
      utterance.onerror = () => setState((current) => (current === "speaking" ? "idle" : current));
      setState("speaking");
      window.speechSynthesis.speak(utterance);
    },
    [lang],
  );

  /**
   * Reads `text` aloud. With `audioUrl` (the server's ElevenLabs voice) it streams
   * that instead, and falls back to the browser's voice if it can't play.
   */
  const speak = useCallback(
    (text: string, audioUrl?: string) => {
      if (!text) return;
      silence();
      if (!audioUrl || typeof Audio === "undefined") {
        speakInBrowser(text);
        return;
      }
      const el = (audio.current ??= new Audio());
      let fellBack = false;
      const fallBack = () => {
        if (fellBack) return;
        fellBack = true;
        el.onended = el.onerror = null;
        speakInBrowser(text);
      };
      el.onended = () => {
        el.onended = el.onerror = null;
        setState((current) => (current === "speaking" ? "idle" : current));
      };
      el.onerror = fallBack;
      el.src = audioUrl;
      setState("speaking");
      el.play().catch(fallBack);
    },
    [silence, speakInBrowser],
  );

  /** Silences everything, e.g. when the widget closes. */
  const stopAll = useCallback(() => {
    recognition.current?.abort();
    recognition.current = null;
    recording.current?.abort();
    recording.current = null;
    setInterim("");
    silence();
    setState("idle");
  }, [silence]);

  useEffect(() => stopAll, [stopAll]);

  /** Which service hears the next question. */
  const hearsWith = recordsForServer ? "elevenlabs" : "browser";

  return { canListen, canSpeak, hearsWith, state, interim, listen, stopListening, speak, stopSpeaking, stopAll };
}
