import { expect, test, type Page } from "@playwright/test";
import { chat, openChat, signIn } from "./chat";

/*
 * Headless Chromium has no speech service, so these tests install a fake
 * SpeechRecognition that "hears" a set phrase, and a speechSynthesis that
 * records what would be read aloud instead of playing it.
 */

declare global {
  interface Window {
    __heard: string;
    __recognitionError: string | null;
    __spoken: string[];
  }
}

async function fakeSpeech(page: Page, heard: string, error: string | null = null) {
  await page.addInitScript(
    ({ heard, error }) => {
      window.__heard = heard;
      window.__recognitionError = error;
      window.__spoken = [];

      class FakeRecognition {
        lang = "";
        interimResults = false;
        continuous = false;
        maxAlternatives = 1;
        onresult: ((event: unknown) => void) | null = null;
        onerror: ((event: { error: string }) => void) | null = null;
        onend: (() => void) | null = null;
        start() {
          setTimeout(() => {
            if (window.__recognitionError) {
              this.onerror?.({ error: window.__recognitionError });
            } else {
              const words = window.__heard.split(" ");
              // A partial result first, as a real recognizer streams them.
              this.onresult?.({ resultIndex: 0, results: [{ isFinal: false, 0: { transcript: words[0] } }] });
              this.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: window.__heard } }] });
            }
            this.onend?.();
          }, 50);
        }
        stop() {}
        abort() {}
      }
      // Newer Chromium has the unprefixed name too, and the widget prefers it.
      const w = window as unknown as { SpeechRecognition: unknown; webkitSpeechRecognition: unknown };
      w.SpeechRecognition = FakeRecognition;
      w.webkitSpeechRecognition = FakeRecognition;

      window.speechSynthesis.speak = (utterance: SpeechSynthesisUtterance) => {
        window.__spoken.push(utterance.text);
      };
    },
    { heard, error },
  );
}

test("answers a spoken question in the chat and reads the answer aloud", async ({ page }) => {
  await fakeSpeech(page, "How long does Starter keep raw events?");
  await page.goto("/");
  await openChat(page);

  const reply = page.waitForResponse((res) => res.url().endsWith("/api/chat") && res.request().method() === "POST");
  await chat(page).getByRole("button", { name: "Ask by voice" }).click();
  const request = (await reply).request();
  expect(request.postDataJSON()).toMatchObject({ message: "How long does Starter keep raw events?", channel: "voice" });

  // The transcript shows as the visitor's message, and the answer keeps its citation.
  await expect(chat(page).getByText("How long does Starter keep raw events?")).toBeVisible();
  await expect(chat(page).getByText(/^Starter keeps raw events 30 days/)).toBeVisible();
  await expect(chat(page).getByText("Answer based on")).toBeVisible();

  await expect.poll(() => page.evaluate(() => window.__spoken)).toEqual([
    expect.stringMatching(/^Starter keeps raw events 30 days/),
  ]);
});

test("a spoken question the help center can't answer opens a ticket, and says so without the id", async ({ page }) => {
  await fakeSpeech(page, "How do I connect Nimbus to Salesforce?");
  await page.goto("/");
  await openChat(page);

  const reply = page.waitForResponse((res) => res.url().endsWith("/api/chat") && res.request().method() === "POST");
  await chat(page).getByRole("button", { name: "Ask by voice" }).click();
  const body = (await (await reply).json()) as { ticketId: string | null };
  expect(body.ticketId).toBeTruthy();

  await expect(chat(page).getByRole("link", { name: "staff inbox" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__spoken.length)).toBe(1);
  const spoken = await page.evaluate(() => window.__spoken[0]!);
  expect(spoken).toContain("I've passed this to the team.");
  expect(spoken).not.toContain(body.ticketId!);
});

test("typed questions are not read aloud", async ({ page }) => {
  await fakeSpeech(page, "unused");
  await page.goto("/");
  await openChat(page);

  const reply = page.waitForResponse((res) => res.url().endsWith("/api/chat") && res.request().method() === "POST");
  await chat(page).getByPlaceholder("Type a message").fill("How long does Starter keep raw events?");
  await chat(page).getByRole("button", { name: "Send" }).click();
  expect((await reply).request().postDataJSON()).toMatchObject({ channel: "text" });
  await expect(chat(page).getByText(/^Starter keeps raw events 30 days/)).toBeVisible();
  expect(await page.evaluate(() => window.__spoken)).toEqual([]);
});

test("a blocked microphone explains itself and leaves typing available", async ({ page }) => {
  await fakeSpeech(page, "", "not-allowed");
  await page.goto("/");
  await openChat(page);

  await chat(page).getByRole("button", { name: "Ask by voice" }).click();
  await expect(chat(page).getByRole("alert")).toHaveText(/Microphone access is blocked/);
  await expect(chat(page).getByPlaceholder("Type a message")).toBeEditable();
});

test("browsers without speech recognition get no mic button", async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
    delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
  });
  await page.goto("/");
  await openChat(page);
  await expect(chat(page).getByRole("button", { name: "Send" })).toBeVisible();
  await expect(chat(page).getByRole("button", { name: "Ask by voice" })).toHaveCount(0);
});

/**
 * Makes /api/voice say this business uses ElevenLabs, without a real key in the
 * e2e server, and fakes the microphone: a MediaRecorder that "records" until
 * it's stopped. No AudioContext, so pause detection is off and the test taps stop.
 */
async function pretendServerVoice(page: Page, { transcript }: { transcript?: string } = {}) {
  await page.route("**/api/voice?**", (route) => route.fulfill({ json: { provider: "elevenlabs" } }));
  if (transcript !== undefined) {
    await page.route("**/api/transcribe?**", (route) => route.fulfill({ json: { text: transcript } }));
  }
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__recordings = 0;
    delete w.AudioContext;
    delete w.webkitAudioContext;
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: async () => ({ getTracks: () => [] }) },
    });
    class FakeMediaRecorder {
      state = "inactive";
      mimeType = "audio/webm";
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      start() {
        this.state = "recording";
        (w.__recordings as number)++;
      }
      stop() {
        if (this.state === "inactive") return;
        this.state = "inactive";
        this.ondataavailable?.({ data: new Blob(["fake audio"], { type: "audio/webm" }) });
        this.onstop?.();
      }
    }
    w.MediaRecorder = FakeMediaRecorder;
  });
}

/** A tenth of a second of silence, as an 8 kHz 8-bit mono WAV, standing in for ElevenLabs audio. */
function silentWav(): Buffer {
  const samples = 800;
  const wav = Buffer.alloc(44 + samples, 0x80);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + samples, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); // PCM
  wav.writeUInt16LE(1, 22); // mono
  wav.writeUInt32LE(8000, 24);
  wav.writeUInt32LE(8000, 28);
  wav.writeUInt16LE(1, 32);
  wav.writeUInt16LE(8, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(samples, 40);
  return wav;
}

/** Opens the chat and waits until the widget knows it should use ElevenLabs. */
async function openServerVoiceChat(page: Page) {
  await page.goto("/");
  await openChat(page);
  await expect(chat(page).getByRole("button", { name: "Ask by voice" })).toHaveAttribute("data-voice", "elevenlabs");
}

async function askOutLoud(page: Page) {
  await chat(page).getByRole("button", { name: "Ask by voice" }).click();
  await expect(chat(page).getByPlaceholder("Listening…")).toBeVisible();
  await chat(page).getByRole("button", { name: "Stop listening" }).click();
}

test("with ElevenLabs on, the question is transcribed on the server and the answer streams from /api/speech", async ({ page }) => {
  await fakeSpeech(page, "unused: the browser recognizer should not run");
  await pretendServerVoice(page, { transcript: "How long does Starter keep raw events?" });
  await page.route("**/api/speech?**", (route) => route.fulfill({ contentType: "audio/wav", body: silentWav() }));
  await page.addInitScript(() => {
    (window as unknown as { __played: string[] }).__played = [];
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      if (!this.src.startsWith("data:")) (window as unknown as { __played: string[] }).__played.push(this.src);
      return Promise.resolve();
    };
  });
  await openServerVoiceChat(page);

  const transcribe = page.waitForRequest((req) => req.url().includes("/api/transcribe"));
  const reply = page.waitForResponse((res) => res.url().endsWith("/api/chat") && res.request().method() === "POST");
  await askOutLoud(page);
  const upload = await transcribe;
  expect(new URL(upload.url()).searchParams.get("business")).toBe("nimbus");
  expect(upload.headers()["content-type"]).toBe("audio/webm");
  expect(upload.postData()).toBe("fake audio");

  const chatRequest = (await reply).request();
  expect(chatRequest.postDataJSON()).toMatchObject({ message: "How long does Starter keep raw events?", channel: "voice" });
  const body = (await (await reply).json()) as { conversationId: string; messages: { id: string; role: string }[] };
  const answer = body.messages.findLast((m) => m.role === "assistant")!;
  await expect(chat(page).getByText(/^Starter keeps raw events 30 days/)).toBeVisible();

  await expect.poll(() => page.evaluate(() => (window as unknown as { __played: string[] }).__played)).toHaveLength(1);
  const played = new URL(await page.evaluate(() => (window as unknown as { __played: string[] }).__played[0]!));
  expect(played.pathname).toBe("/api/speech");
  expect(Object.fromEntries(played.searchParams)).toEqual({
    business: "nimbus",
    conversationId: body.conversationId,
    messageId: answer.id,
  });
  expect(await page.evaluate(() => window.__spoken)).toEqual([]);
  await expect(chat(page).getByRole("button", { name: "Stop reading aloud" })).toBeVisible();
});

test("with ElevenLabs on, browsers without speech recognition get the mic too", async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
    delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
  });
  await pretendServerVoice(page, { transcript: "How long does Starter keep raw events?" });
  await openServerVoiceChat(page);

  await askOutLoud(page);
  await expect(chat(page).getByText(/^Starter keeps raw events 30 days/)).toBeVisible();
});

test("when ElevenLabs can't play the answer, the browser reads it instead", async ({ page }) => {
  await fakeSpeech(page, "unused");
  await pretendServerVoice(page, { transcript: "How long does Starter keep raw events?" });
  // The e2e server has no ElevenLabs key, so the real /api/speech refuses and the audio fails.
  await openServerVoiceChat(page);

  await askOutLoud(page);
  await expect.poll(() => page.evaluate(() => window.__spoken)).toEqual([
    expect.stringMatching(/^Starter keeps raw events 30 days/),
  ]);
});

test("when the business runs out of ElevenLabs minutes, the next question uses the browser's recognizer", async ({ page }) => {
  await fakeSpeech(page, "How long does Starter keep raw events?");
  await pretendServerVoice(page);
  await page.route("**/api/transcribe?**", (route) =>
    route.fulfill({ status: 409, json: { error: "voice unavailable", provider: "browser" } }),
  );
  await openServerVoiceChat(page);

  await askOutLoud(page);
  await expect(chat(page).getByRole("alert")).toHaveText(/couldn't hear that clearly/);

  const reply = page.waitForResponse((res) => res.url().endsWith("/api/chat") && res.request().method() === "POST");
  await chat(page).getByRole("button", { name: "Ask by voice" }).click();
  expect((await reply).request().postDataJSON()).toMatchObject({ message: "How long does Starter keep raw events?" });
  expect(await page.evaluate(() => (window as unknown as { __recordings: number }).__recordings)).toBe(1);
});

test("without a key, the voice routes stay off and point the widget at the browser's voice", async ({ request }) => {
  expect(await (await request.get("/api/voice?business=nimbus")).json()).toEqual({ provider: "browser" });
  expect((await request.get("/api/voice?business=nope")).status()).toBe(404);

  const transcribe = await request.post("/api/transcribe?business=nimbus", {
    headers: { "Content-Type": "audio/webm" },
    data: Buffer.from("fake audio"),
  });
  expect(transcribe.status()).toBe(409);
  expect(await transcribe.json()).toMatchObject({ provider: "browser" });

  const speech = await request.get("/api/speech?business=nimbus&conversationId=nope&messageId=nope");
  expect(speech.status()).toBe(409);
});

test("Setup shows the voice switch, and ElevenLabs can't be turned on without a key", async ({ page }) => {
  await signIn(page);
  await page.goto("/inbox/setup");
  await expect(page.getByText("Browser voice", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Use ElevenLabs" })).toBeDisabled();
  await expect(page.getByText("Needs ELEVENLABS_API_KEY on the server.")).toBeVisible();

  const res = await page.request.post("/api/voice", { data: { provider: "elevenlabs" } });
  expect(res.status()).toBe(409);
});
