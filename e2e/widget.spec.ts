import { expect, test, type Page } from "@playwright/test";

type ChatReply = { ticketId: string | null; escalated: boolean };

const RETENTION_QUESTION = "How long does Starter keep raw events?";

function chat(page: Page) {
  return page.getByRole("region", { name: "Nimbus support chat" });
}

async function openChat(page: Page) {
  await page.getByRole("button", { name: "Ask Nimbus" }).click();
  await expect(chat(page)).toBeVisible();
}

async function ask(page: Page, text: string): Promise<ChatReply> {
  const response = page.waitForResponse(
    (res) => res.url().endsWith("/api/chat") && res.request().method() === "POST",
  );
  await chat(page).getByPlaceholder("Type a message").fill(text);
  await chat(page).getByRole("button", { name: "Send" }).click();
  return (await response).json();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await openChat(page);
});

test("answers a follow-up using the earlier question", async ({ page }) => {
  await ask(page, RETENTION_QUESTION);
  await expect(chat(page).getByText(/^Starter keeps raw events 30 days/)).toBeVisible();

  // Asked cold, this quotes the CSV row cap instead.
  const reply = await ask(page, "Can I export them first?");
  expect(reply.escalated).toBe(false);
  await expect(chat(page).getByText(/^Export first\./)).toBeVisible();
});

test("thanks gets a reply, not a ticket", async ({ page }) => {
  await ask(page, RETENTION_QUESTION);
  const reply = await ask(page, "Thanks!");

  expect(reply.ticketId).toBeNull();
  await expect(chat(page).getByText("Glad to help. Anything else about Nimbus?")).toBeVisible();
  await expect(chat(page).getByRole("link", { name: "staff inbox" })).toHaveCount(0);
});

test("picks the conversation back up after a reload", async ({ page }) => {
  await ask(page, RETENTION_QUESTION);
  await page.reload();
  await openChat(page);
  await expect(chat(page).getByText(RETENTION_QUESTION)).toBeVisible();

  await ask(page, "Can I export them first?");
  await expect(chat(page).getByText(/^Export first\./)).toBeVisible();
});

test("an unanswerable follow-up lands in the staff inbox", async ({ page }) => {
  await ask(page, RETENTION_QUESTION);
  const reply = await ask(page, "What about Salesforce?");

  expect(reply.ticketId).toBeTruthy();
  await expect(chat(page).getByText(/^I don't have that in the Nimbus help center\./)).toBeVisible();
  await expect(chat(page).getByRole("link", { name: "staff inbox" })).toBeVisible();

  await page.goto("/login");
  await page.getByLabel("Password").fill("nimbus-demo");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/inbox$/);
  await expect(page.locator(`a[href="/inbox/${reply.ticketId}"]`)).toContainText(
    "What about Salesforce?",
  );
});

test("'This didn't help' opens a ticket", async ({ page }) => {
  await ask(page, RETENTION_QUESTION);
  const response = page.waitForResponse((res) => res.url().endsWith("/api/chat"));
  await chat(page).getByRole("button", { name: "This didn't help" }).click();

  expect(((await (await response).json()) as ChatReply).ticketId).toBeTruthy();
  await expect(chat(page).getByRole("link", { name: "staff inbox" })).toBeVisible();
});
