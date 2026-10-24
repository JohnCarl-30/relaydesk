/*
 * Records one spoken question for server-side speech to text. Like the
 * browser's recognizer, it stops by itself once the visitor pauses, so voice
 * feels the same whichever service hears it. Works in Firefox too.
 */

export function canRecord(): boolean {
  return typeof window !== "undefined" && "MediaRecorder" in window && Boolean(navigator.mediaDevices?.getUserMedia);
}

export type Recording = {
  /** Stop and keep what was said so far. */
  stop(): void;
  /** Stop and throw it away, e.g. when the widget closes. */
  abort(): void;
  /** The audio, or null if aborted. `heard` is false when it never picked up a voice. */
  done: Promise<{ audio: Blob; heard: boolean } | null>;
};

/** Loudness (RMS of the waveform, 0–1) that counts as someone talking. */
const SPEECH_LEVEL = 0.03;
/** How long a pause ends the question. */
const PAUSE_MS = 1_400;
/** Give up when nobody speaks for this long. */
const NO_SPEECH_MS = 7_000;

/** The error code, in the browser recognizer's terms, for a microphone that won't open. */
export function microphoneErrorCode(error: unknown): string {
  const name = error instanceof Error || error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "not-allowed";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "audio-capture";
  return "unknown";
}

/** Opens the microphone and starts recording. Rejects if the microphone can't be opened. */
export async function recordQuestion({ maxSeconds }: { maxSeconds: number }): Promise<Recording> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  const recorder = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  let aborted = false;

  // Pause detection. Without an AudioContext it still stops on tap or at maxSeconds.
  const AudioContextClass = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  const context = AudioContextClass ? new AudioContextClass() : null;
  const analyser = context?.createAnalyser();
  if (context && analyser) context.createMediaStreamSource(stream).connect(analyser);
  // With no way to measure, assume they spoke and let the transcript decide.
  let heard = !analyser;
  const samples = new Uint8Array(analyser?.fftSize ?? 0);
  const startedAt = Date.now();
  let lastVoiceAt = startedAt;

  const stop = () => {
    if (recorder.state !== "inactive") recorder.stop();
  };
  const tick = window.setInterval(() => {
    const now = Date.now();
    if (analyser) {
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) sum += ((sample - 128) / 128) ** 2;
      if (Math.sqrt(sum / samples.length) > SPEECH_LEVEL) {
        heard = true;
        lastVoiceAt = now;
      }
      if (heard && now - lastVoiceAt > PAUSE_MS) stop();
      if (!heard && now - startedAt > NO_SPEECH_MS) stop();
    }
    if (now - startedAt > maxSeconds * 1000) stop();
  }, 100);

  const done = new Promise<{ audio: Blob; heard: boolean } | null>((resolve) => {
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onstop = () => {
      window.clearInterval(tick);
      for (const track of stream.getTracks()) track.stop();
      void context?.close().catch(() => {});
      resolve(aborted ? null : { audio: new Blob(chunks, { type: recorder.mimeType || "audio/webm" }), heard });
    };
  });
  recorder.start();

  return {
    stop,
    abort() {
      aborted = true;
      stop();
    },
    done,
  };
}
