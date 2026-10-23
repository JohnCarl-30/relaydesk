import { expect, type Page } from "@playwright/test";
import { ADMIN_EMAIL, ADMIN_PASSWORD } from "./env";

export type ChatReply = { ticketId: string | null; escalated: boolean };

export function chat(page: Page, business = "Nimbus") {
  return page.getByRole("region", { name: `${business} support chat` });
}

export async function openChat(page: Page, business = "Nimbus") {
  await page.getByRole("button", { name: `Ask ${business}` }).click();
  await expect(chat(page, business)).toBeVisible();
}

/** Start waiting before the click that sends the message. */
export async function nextChatReply(page: Page): Promise<ChatReply> {
  const response = await page.waitForResponse(
    (res) => res.url().endsWith("/api/chat") && res.request().method() === "POST",
  );
  return response.json();
}

export async function ask(page: Page, text: string, business = "Nimbus"): Promise<ChatReply> {
  const reply = nextChatReply(page);
  await chat(page, business).getByPlaceholder("Type a message").fill(text);
  await chat(page, business).getByRole("button", { name: "Send" }).click();
  return reply;
}

export async function signIn(page: Page, email = ADMIN_EMAIL, password = ADMIN_PASSWORD) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/inbox$/);
}
