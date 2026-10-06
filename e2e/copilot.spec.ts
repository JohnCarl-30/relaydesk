import { expect, test } from "@playwright/test";
import { ask, openChat, signIn } from "./chat";

test("a new ticket gets a reviewable draft, and Send posts it to the customer", async ({ page }) => {
  await page.goto("/");
  await openChat(page);
  const reply = await ask(page, "How do I connect Nimbus to Salesforce?");
  expect(reply.ticketId).toBeTruthy();

  await signIn(page);
  const card = page.getByRole("region", { name: "Suggested reply" });
  // The co-pilot runs after the chat response, so the draft can trail by a moment.
  await expect(async () => {
    await page.goto(`/inbox/${reply.ticketId}`);
    await expect(card).toContainText("Holding reply", { timeout: 1_000 });
  }).toPass({ timeout: 15_000 });

  await expect(card).toContainText("The help center has no answer for this.");
  const draft = card.getByRole("textbox", { name: "Suggested reply text" });
  await expect(draft).toHaveValue(/Our help center doesn't cover this yet/);

  await card.getByRole("button", { name: "Send", exact: true }).click();

  await expect(page.locator("ol").getByText(/Our help center doesn't cover this yet/)).toBeVisible();
  await expect(card).toContainText("No suggested reply yet.");
});
