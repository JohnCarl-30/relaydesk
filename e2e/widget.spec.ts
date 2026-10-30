import { expect, test } from "@playwright/test";
import { ask, chat, nextChatReply, openChat, signIn } from "./chat";

const RETENTION_QUESTION = "How long does Starter keep raw events?";

test.beforeEach(async ({ page }) => {
  await page.goto("/demo");
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

  await signIn(page);
  await expect(page.locator(`a[href="/inbox/${reply.ticketId}"]`)).toContainText(
    "What about Salesforce?",
  );
});

test("'This didn't help' opens a ticket", async ({ page }) => {
  await ask(page, RETENTION_QUESTION);
  const reply = nextChatReply(page);
  await chat(page).getByRole("button", { name: "This didn't help" }).click();

  expect((await reply).ticketId).toBeTruthy();
  await expect(chat(page).getByRole("link", { name: "staff inbox" })).toBeVisible();
});

test("a staff reply shows up in the open chat without a reload", async ({ page, browser }) => {
  const reply = await ask(page, "How do I connect Nimbus to Salesforce?");
  expect(reply.ticketId).toBeTruthy();

  const staff = await (await browser.newContext()).newPage();
  await signIn(staff);
  const sent = await staff.request.post(`/api/tickets/${reply.ticketId}/reply`, {
    data: { body: "Salesforce sync is on our roadmap for Q1." },
  });
  expect(sent.ok()).toBe(true);

  // The widget checks every 15 seconds.
  await expect(chat(page).getByText("Salesforce sync is on our roadmap for Q1.")).toBeVisible({ timeout: 20_000 });
  await staff.context().close();
});
