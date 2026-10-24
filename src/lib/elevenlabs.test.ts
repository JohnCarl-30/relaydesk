import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  allowPlay,
  DEFAULT_MODEL_ID,
  DEFAULT_VOICE_ID,
  elevenLabsConfig,
  PLAYS_PER_MESSAGE,
  readTranscript,
  speechRequest,
  TRANSCRIBE_MODEL_ID,
  transcribeRequest,
} from "./elevenlabs";

describe("elevenLabsConfig", () => {
  it("is off without a key, so the widget keeps the browser's voice", () => {
    assert.equal(elevenLabsConfig({}), null);
    assert.equal(elevenLabsConfig({ ELEVENLABS_API_KEY: "  " }), null);
  });

  it("defaults the voice, model and host, and lets each be overridden", () => {
    assert.deepEqual(elevenLabsConfig({ ELEVENLABS_API_KEY: "sk_1" }), {
      apiKey: "sk_1",
      voiceId: DEFAULT_VOICE_ID,
      modelId: DEFAULT_MODEL_ID,
      baseUrl: "https://api.elevenlabs.io",
    });
    assert.deepEqual(
      elevenLabsConfig({
        ELEVENLABS_API_KEY: "sk_1",
        ELEVENLABS_VOICE_ID: "voice-2",
        ELEVENLABS_MODEL: "eleven_v4_turbo",
        ELEVENLABS_BASE_URL: "https://api.eu.residency.elevenlabs.io/",
      }),
      { apiKey: "sk_1", voiceId: "voice-2", modelId: "eleven_v4_turbo", baseUrl: "https://api.eu.residency.elevenlabs.io" },
    );
  });
});

describe("speechRequest", () => {
  it("streams MP3 for the configured voice, with the key in a header and not the URL", () => {
    const config = elevenLabsConfig({ ELEVENLABS_API_KEY: "sk_1", ELEVENLABS_VOICE_ID: "a/b" })!;
    const { url, init } = speechRequest(config, "SSO is on Growth.");
    assert.equal(url, "https://api.elevenlabs.io/v1/text-to-speech/a%2Fb/stream?output_format=mp3_44100_64");
    assert.ok(!url.includes("sk_1"));
    assert.equal(init.method, "POST");
    assert.equal((init.headers as Record<string, string>)["xi-api-key"], "sk_1");
    assert.deepEqual(JSON.parse(init.body as string), { text: "SSO is on Growth.", model_id: DEFAULT_MODEL_ID });
  });
});

describe("allowPlay", () => {
  it("lets an answer play a set number of times, then refuses", () => {
    const id = crypto.randomUUID();
    for (let i = 0; i < PLAYS_PER_MESSAGE; i++) assert.equal(allowPlay(id), true);
    assert.equal(allowPlay(id), false);
    assert.equal(allowPlay(crypto.randomUUID()), true);
  });
});

describe("transcribeRequest", () => {
  it("sends the recording to Scribe as a form, with the key in a header", async () => {
    const config = elevenLabsConfig({ ELEVENLABS_API_KEY: "sk_1" })!;
    const { url, init } = transcribeRequest(config, new Blob(["audio"], { type: "audio/webm" }), "question.webm");
    assert.equal(url, "https://api.elevenlabs.io/v1/speech-to-text");
    assert.equal((init.headers as Record<string, string>)["xi-api-key"], "sk_1");
    const form = init.body as FormData;
    assert.equal(form.get("model_id"), TRANSCRIBE_MODEL_ID);
    assert.equal(form.get("tag_audio_events"), "false");
    const file = form.get("file") as File;
    assert.equal(file.name, "question.webm");
    assert.equal(await file.text(), "audio");
  });
});

describe("readTranscript", () => {
  it("takes the text, and the audio length from the last word", () => {
    assert.deepEqual(
      readTranscript({
        text: " Magkano ang Growth plan? ",
        words: [
          { text: "Magkano", start: 0.2, end: 0.8 },
          { text: " ", start: 0.8, end: 0.9 },
          { text: "plan?", start: 1.6, end: 2.4 },
        ],
      }),
      { text: "Magkano ang Growth plan?", seconds: 2.4 },
    );
  });

  it("copes with an empty or odd response", () => {
    assert.deepEqual(readTranscript(null), { text: "", seconds: 0 });
    assert.deepEqual(readTranscript({ text: 3, words: [{ end: "x" }] }), { text: "", seconds: 0 });
  });
});
