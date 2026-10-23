import { expect, test } from "@playwright/test";
import { ask, chat, openChat, signIn } from "./chat";
import { ACME } from "./env";

// Nimbus's seeded ticket, which no other business should reach.
const NIMBUS_TICKET = "tkt_seats";

test("a business's help center shows only its own articles", async ({ page }) => {
  await page.goto(`/h/${ACME.id}`);
  await expect(page.getByRole("link", { name: "Where do you deliver?" }).first()).toBeVisible();
  await expect(page.getByText("Set up Google or Okta SSO")).toHaveCount(0);

  await page.getByRole("link", { name: "Where do you deliver?" }).first().click();
  await expect(page).toHaveURL(new RegExp(`/h/${ACME.id}/delivery-areas$`));
  await expect(page.getByRole("heading", { name: "Where do you deliver?" })).toBeVisible();
});

test("a business's widget answers from its own articles", async ({ page }) => {
  await page.goto(`/h/${ACME.id}`);
  await openChat(page, ACME.name);
  const reply = await ask(page, "How long does delivery take outside Metro Manila?", ACME.name);
  expect(reply.escalated).toBe(false);
  const source = chat(page, ACME.name).getByRole("link", { name: "Where do you deliver?" });
  await expect(source).toHaveAttribute("href", `/h/${ACME.id}/delivery-areas`);
});

test("a question only Nimbus can answer gets a ticket at the other business", async ({ page }) => {
  await page.goto(`/h/${ACME.id}`);
  await openChat(page, ACME.name);
  const reply = await ask(page, "How do I set up Okta SSO?", ACME.name);
  expect(reply.escalated).toBe(true);
  await expect(chat(page, ACME.name)).toContainText(
    `I don't have that in the ${ACME.name} help center.`,
  );
  // A real business's visitors are not sent to the staff inbox.
  await expect(chat(page, ACME.name).getByRole("link", { name: "staff inbox" })).toHaveCount(0);

  await signIn(page, ACME.email, ACME.password);
  await expect(page.getByText("How do I set up Okta SSO?").first()).toBeVisible();
});

test("staff only see and touch their own business's tickets", async ({ page }) => {
  await signIn(page, ACME.email, ACME.password);
  await expect(page.getByText("Invoice shows 12 seats")).toHaveCount(0);

  const api = page.request;
  expect((await api.get(`/api/tickets/${NIMBUS_TICKET}`)).status()).toBe(404);
  expect(
    (await api.post(`/api/tickets/${NIMBUS_TICKET}/reply`, { data: { body: "hi" } })).status(),
  ).toBe(404);
  expect(
    (await api.patch(`/api/tickets/${NIMBUS_TICKET}`, { data: { status: "closed" } })).status(),
  ).toBe(404);
  expect((await api.post(`/api/tickets/${NIMBUS_TICKET}/draft`)).status()).toBe(404);
  const listed = (await (await api.get("/api/tickets")).json()) as { tickets: { id: string }[] };
  expect(listed.tickets.map((t) => t.id)).not.toContain(NIMBUS_TICKET);

  await page.goto(`/inbox/${NIMBUS_TICKET}`);
  await expect(page.getByText("Invoice shows 12 seats")).toHaveCount(0);
});

test("a widget can't read another business's conversation", async ({ request }) => {
  const read = await request.get(
    `/api/chat?business=${ACME.id}&conversationId=conv_billing_seats`,
  );
  expect(read.status()).toBe(404);
  expect((await request.get("/api/chat?conversationId=conv_billing_seats")).status()).toBe(400);
  expect((await request.post("/api/chat", { data: { message: "hi" } })).status()).toBe(400);
  expect(
    (await request.post("/api/chat", { data: { business: "no-such-shop", message: "hi" } })).status(),
  ).toBe(404);

  // Posting into Nimbus's conversation id from Acme's widget starts a fresh Acme thread instead.
  const posted = await request.post("/api/chat", {
    data: { business: ACME.id, conversationId: "conv_billing_seats", message: "What are your store hours?" },
  });
  const body = (await posted.json()) as { conversationId: string; messages: { body: string }[] };
  expect(body.conversationId).not.toBe("conv_billing_seats");
  expect(body.messages.map((m) => m.body).join("\n")).not.toContain("12 seats");
});

test("an unknown business has no help center", async ({ page }) => {
  expect((await page.goto("/h/no-such-shop"))?.status()).toBe(404);
  expect((await page.goto("/embed/no-such-shop"))?.status()).toBe(404);
});

test("embed.js puts the business's widget on another site and resizes it", async ({ page, baseURL }) => {
  await page.goto("/embed.js"); // any page on the origin, so the host page below can load the script
  await page.setContent(
    `<!doctype html><html><body><h1>Acme's own site</h1>
     <script src="${baseURL}/embed.js" data-business="${ACME.id}"></script></body></html>`,
  );
  const iframe = page.locator(`iframe[data-relaydesk="${ACME.id}"]`);
  await expect(iframe).toHaveCSS("width", "96px");

  const widget = page.frameLocator(`iframe[data-relaydesk="${ACME.id}"]`);
  await widget.getByRole("button", { name: `Ask ${ACME.name}` }).click();
  await expect(widget.getByRole("region", { name: `${ACME.name} support chat` })).toBeVisible();
  await expect(iframe).toHaveCSS("width", "420px");
});
