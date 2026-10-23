import { expect, test, type Page } from "@playwright/test";
import { chat, openChat } from "./chat";

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
