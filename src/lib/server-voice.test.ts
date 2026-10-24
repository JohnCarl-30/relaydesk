import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import * as db from "./db";
import { forceExtractiveAnswers } from "./keyless";
import {
  DEFAULT_VOICE_MINUTES,
  recordVoiceSeconds,
  setVoiceProvider,
  speakingSeconds,
  voiceMinutesCap,
  voiceStatus,
} from "./server-voice";

forceExtractiveAnswers();
process.env.RELAYDESK_DB_PATH = join(tmpdir(), `relaydesk-server-voice-${process.pid}-${Date.now()}.db`);

let n = 0;
function business(): string {
  const id = `voice-${process.pid}-${n++}`;
  db.createBusiness({ id, name: "Voice Test" });
  return id;
}

afterEach(() => {
  delete process.env.ELEVENLABS_API_KEY;
  delete process.env.RELAYDESK_VOICE_MINUTES;
});

describe("voiceStatus", () => {
  it("uses the browser's voice until the server has a key and the business switches ElevenLabs on", () => {
    const id = business();
    assert.equal(voiceStatus(id).provider, "browser");

    setVoiceProvider(id, "elevenlabs");
    assert.deepEqual(
      { ...voiceStatus(id) },
      { configured: false, enabled: true, usedSeconds: 0, capSeconds: DEFAULT_VOICE_MINUTES * 60, provider: "browser" },
    );

    process.env.ELEVENLABS_API_KEY = "sk_test";
    assert.equal(voiceStatus(id).provider, "elevenlabs");

    setVoiceProvider(id, "browser");
    assert.equal(voiceStatus(id).provider, "browser");
  });

  it("goes back to the browser's voice when the month's minutes run out", () => {
    process.env.ELEVENLABS_API_KEY = "sk_test";
    process.env.RELAYDESK_VOICE_MINUTES = "1";
    const id = business();
    setVoiceProvider(id, "elevenlabs");

    recordVoiceSeconds(id, 45);
    assert.equal(voiceStatus(id).provider, "elevenlabs");
    recordVoiceSeconds(id, 15);
    assert.equal(voiceStatus(id).usedSeconds, 60);
    assert.equal(voiceStatus(id).provider, "browser");
  });

  it("counts minutes per business and per month", () => {
    const a = business();
    const b = business();
    db.addVoiceSeconds(a, 30, "2026-09");
    db.addVoiceSeconds(a, 10, "2026-10");
    db.addVoiceSeconds(a, 5, "2026-10");
    db.addVoiceSeconds(b, 7, "2026-10");
    assert.equal(db.voiceSecondsUsed(a, "2026-09"), 30);
    assert.equal(db.voiceSecondsUsed(a, "2026-10"), 15);
    assert.equal(db.voiceSecondsUsed(b, "2026-10"), 7);
    assert.equal(db.usageMonth(new Date("2026-10-31T23:59:59Z")), "2026-10");
  });
});

describe("voiceMinutesCap", () => {
  it("reads RELAYDESK_VOICE_MINUTES, and ignores values that aren't a number of minutes", () => {
    assert.equal(voiceMinutesCap({}), DEFAULT_VOICE_MINUTES);
    assert.equal(voiceMinutesCap({ RELAYDESK_VOICE_MINUTES: "120" }), 120);
    assert.equal(voiceMinutesCap({ RELAYDESK_VOICE_MINUTES: "0" }), 0);
    for (const bad of ["", " ", "lots", "-5"]) assert.equal(voiceMinutesCap({ RELAYDESK_VOICE_MINUTES: bad }), DEFAULT_VOICE_MINUTES);
  });
});

describe("speakingSeconds", () => {
  it("estimates about 15 characters a second, rounding up", () => {
    assert.equal(speakingSeconds(""), 0);
    assert.equal(speakingSeconds("a".repeat(15)), 1);
    assert.equal(speakingSeconds("a".repeat(16)), 2);
  });
});
