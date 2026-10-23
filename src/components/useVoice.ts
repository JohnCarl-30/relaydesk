"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { recognitionErrorMessage } from "@/lib/voice";

/*
 * Push-to-talk on the browser's own speech services: SpeechRecognition turns
 * the visitor's question into text, speechSynthesis reads the answer back.
 * No key and no audio leaves the page through relaydesk. Chrome, Edge and
 * Safari support recognition; Firefox does not, so the mic stays hidden there.
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

export type VoiceState = "idle" | "listening" | "speaking";

// Browser support never changes while the page is open, so there is nothing to subscribe to.
const noSubscription = () => () => {};

export function useVoice({ lang, onError }: { lang: string; onError: (message: string) => void }) {
  // False on the server and during hydration, so both renders match; the real answer follows.
  const canListen = useSyncExternalStore(noSubscription, () => recognitionConstructor() !== null, () => false);
  const canSpeak = useSyncExternalStore(noSubscription, () => "speechSynthesis" in window, () => false);
  const [state, setState] = useState<VoiceState>("idle");
  const [interim, setInterim] = useState("");
  const recognition = useRef<Recognition | null>(null);
  const reportError = useRef(onError);
  useEffect(() => {
    reportError.current = onError;
  });

  const stopSpeaking = useCallback(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    setState((current) => (current === "speaking" ? "idle" : current));
  }, []);

  const stopListening = useCallback(() => {
    // stop() still delivers what was heard so far; abort() is for closing the widget.
    recognition.current?.stop();
  }, []);

  /** Listens for one question. `onHeard` gets the final transcript once the visitor stops talking. */
  const listen = useCallback(
    (onHeard: (text: string) => void) => {
      const Constructor = recognitionConstructor();
      if (!Constructor || recognition.current) return;
      // Talking over the bot interrupts it, the way it would on a call.
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();

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
    [lang],
  );

  const speak = useCallback(
    (text: string) => {
      if (!text || typeof window === "undefined" || !("speechSynthesis" in window)) return;
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

  /** Silences everything, e.g. when the widget closes. */
  const stopAll = useCallback(() => {
    recognition.current?.abort();
    recognition.current = null;
    setInterim("");
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    setState("idle");
  }, []);

  useEffect(() => stopAll, [stopAll]);

  return { canListen, canSpeak, state, interim, listen, stopListening, speak, stopSpeaking, stopAll };
}
