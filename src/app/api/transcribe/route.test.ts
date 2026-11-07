import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import * as db from "@/lib/db";
import { setVoiceProvider, voiceStatus } from "@/lib/server-voice";
import { POST } from "./route";

process.env.RELAYDESK_DB_PATH = join(tmpdir(), `relaydesk-transcribe-${process.pid}-${Date.now()}.db`);

let n = 0;
function voiceBusiness(): string {
  const id = `transcribe-${process.pid}-${n++}`;
  db.createBusiness({ id, name: "Transcribe Test" });
  setVoiceProvider(id, "elevenlabs");
  return id;
}

function upload(business: string, headers: Record<string, string>, body: BodyInit = new Uint8Array(8)) {
  return new Request(`http://localhost/api/transcribe?business=${business}`, { method: "POST", headers, body });
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.ELEVENLABS_API_KEY;
});

describe("POST /api/transcribe", () => {
  it("refuses an upload with no content-length before reading the body", async () => {
    process.env.ELEVENLABS_API_KEY = "test-key";
    const res = await POST(upload(voiceBusiness(), { "x-forwarded-for": "203.0.113.1" }));
    assert.equal(res.status, 411);
  });

  it("counts every transcribed second toward the cap, not at most 30", async () => {
    process.env.ELEVENLABS_API_KEY = "test-key";
    globalThis.fetch = async () => Response.json({ text: "hello", words: [{ end: 600 }] });
    const id = voiceBusiness();
    const res = await POST(upload(id, { "content-length": "8", "x-forwarded-for": "203.0.113.2" }));
    assert.equal(res.status, 200);
    assert.equal(voiceStatus(id).usedSeconds, 600);
  });
});
