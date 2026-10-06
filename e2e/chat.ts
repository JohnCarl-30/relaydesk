import { expect, type Page } from "@playwright/test";
import { ADMIN_PASSWORD } from "./env";

export type ChatReply = { ticketId: string | null; escalated: boolean };

export function chat(page: Page) {
  return page.getByRole("region", { name: "Nimbus support chat" });
}

export async function openChat(page: Page) {
  await page.getByRole("button", { name: "Ask Nimbus" }).click();
  await expect(chat(page)).toBeVisible();
}

/** Start waiting before the click that sends the message. */
export async function nextChatReply(page: Page): Promise<ChatReply> {
  const response = await page.waitForResponse(
    (res) => res.url().endsWith("/api/chat") && res.request().method() === "POST",
  );
  return response.json();
}

export async function ask(page: Page, text: string): Promise<ChatReply> {
  const reply = nextChatReply(page);
  await chat(page).getByPlaceholder("Type a message").fill(text);
  await chat(page).getByRole("button", { name: "Send" }).click();
  return reply;
}

export async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/inbox$/);
}
