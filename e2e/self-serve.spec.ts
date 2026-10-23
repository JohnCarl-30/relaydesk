import { expect, test, type Page } from "@playwright/test";

/** A business of our own per test, so parallel workers never share one. */
function newShop(tag: string) {
  const id = `shop-${tag}-${Date.now().toString(36)}`;
  return { id, name: `Shop ${tag}`, email: `owner@${id}.test`, password: "owner-password-1" };
}

async function signUp(page: Page, shop: ReturnType<typeof newShop>) {
  await page.goto("/signup");
  await page.getByLabel("Business name").fill(shop.name);
  await page.getByLabel("Link").fill(shop.id);
  await page.getByLabel("Your name").fill("Ana");
  await page.getByLabel("Email").fill(shop.email);
  await page.getByLabel("Password").fill(shop.password);
  await page.getByRole("button", { name: "Create my help center" }).click();
  await expect(page).toHaveURL(/\/inbox\/setup$/);
}

test("sign up, add an article, try it, go live, and copy the snippet", async ({ page, request }) => {
  const shop = newShop("live");
  await signUp(page, shop);
  await expect(page.getByRole("heading", { name: `Set up ${shop.name}` })).toBeVisible();
  // Not live yet: the public sees nothing.
  expect((await request.get(`/h/${shop.id}`)).status()).toBe(404);
  expect(
    (await request.post("/api/chat", { data: { business: shop.id, message: "hi" } })).status(),
  ).toBe(404);
  await expect(page.getByRole("button", { name: "Go live" })).toBeDisabled();

  await page.goto("/inbox/articles");
  await page.getByLabel("Question or title").fill("Where do you deliver?");
  await page.getByLabel("Category (optional)").fill("Orders");
  await page.getByLabel("Answer").fill("We deliver within Metro Manila in 1 to 2 days. Provinces take 3 to 5 days by courier.");
  await page.getByRole("button", { name: "Add article" }).click();
  await expect(page.getByRole("region", { name: "1 article" })).toContainText("Where do you deliver?");

  await page.goto("/inbox/setup");
  const preview = page.getByRole("region", { name: "Chat preview" });
  await preview.getByLabel("Preview message").fill("How long does delivery to the provinces take?");
  await preview.getByRole("button", { name: "Ask" }).click();
  await expect(preview).toContainText("3 to 5 days");
  await expect(preview).toContainText('From "Where do you deliver?"');
  await preview.getByLabel("Preview message").fill("Do you sell laptops?");
  await preview.getByRole("button", { name: "Ask" }).click();
  await expect(preview).toContainText("would open a ticket");

  await page.getByRole("button", { name: "Go live" }).click();
  await expect(page.getByRole("button", { name: "Hide from the public" })).toBeVisible();
  await expect(page.getByLabel("Embed snippet")).toHaveValue(
    new RegExp(`/embed\\.js" data-business="${shop.id}" async></script>$`),
  );

  // The preview saved nothing.
  await page.goto("/inbox");
  await expect(page.getByText("Do you sell laptops?")).toHaveCount(0);

  await page.goto(`/h/${shop.id}`);
  await expect(page.getByRole("link", { name: "Where do you deliver?" }).first()).toBeVisible();
});

test("import a pasted FAQ, then edit and delete articles", async ({ page }) => {
  await signUp(page, newShop("import"));
  await page.goto("/inbox/articles");
  await page.getByLabel("Articles to import").fill(
    "# Store\n## Store hours\n7 am to 9 pm daily.\n\n## Do you have wifi?\nYes, ask the barista.",
  );
  await page.getByRole("button", { name: "Import" }).click();
  await expect(page.getByRole("status")).toHaveText("Imported 2 articles.");
  const list = page.getByRole("region", { name: "2 articles" });
  await expect(list).toContainText("Store hours");

  await list.getByRole("button", { name: "Edit" }).first().click();
  await list.getByLabel("Answer").fill("8 am to 8 pm daily.");
  await list.getByRole("button", { name: "Save" }).click();
  await expect(list).toContainText("8 am to 8 pm daily.");

  await page.getByRole("button", { name: "Delete Do you have wifi?" }).click();
  await expect(page.getByRole("region", { name: "1 article" })).toBeVisible();

  await page.getByLabel("Articles to import").fill("no heading here");
  await page.getByRole("button", { name: "Import" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "## " })).toBeVisible();
});

test("invite a teammate who joins the same inbox, then remove them", async ({ page, browser }) => {
  const shop = newShop("team");
  await signUp(page, shop);
  await page.goto("/inbox/team");
  await page.getByLabel("Email to invite").fill(`ben@${shop.id}.test`);
  await page.getByRole("button", { name: "Create invite" }).click();
  const link = await page.getByLabel("Invite link").inputValue();
  expect(link).toMatch(/\/invite\/[\w-]+$/);

  const ben = await (await browser.newContext()).newPage();
  await ben.goto(new URL(link).pathname);
  await expect(ben.getByRole("heading", { name: `Join ${shop.name}` })).toBeVisible();
  await ben.getByLabel("Your name").fill("Ben");
  await ben.getByLabel("Password").fill("ben-password-1");
  await ben.getByRole("button", { name: "Join the inbox" }).click();
  await expect(ben).toHaveURL(/\/inbox$/);
  await ben.goto("/inbox/setup");
  await expect(ben.getByRole("heading", { name: `Set up ${shop.name}` })).toBeVisible();

  // The link worked once.
  await ben.goto(new URL(link).pathname);
  await expect(ben.getByRole("heading", { name: "This invite doesn't work" })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("region", { name: "People" })).toContainText("Ben");
  await page.getByRole("button", { name: "Remove Ben" }).click();
  await expect(page.getByRole("region", { name: "People" })).not.toContainText("Ben");

  await ben.goto("/inbox");
  await expect(ben).toHaveURL(/\/login$/);
});

test("sign-up refuses a taken link or email", async ({ page }) => {
  const shop = newShop("dupe");
  await signUp(page, shop);
  await page.context().clearCookies();

  await page.goto("/signup");
  await page.getByLabel("Business name").fill("Another");
  await page.getByLabel("Link").fill(shop.id);
  await page.getByLabel("Your name").fill("Cy");
  await page.getByLabel("Email").fill(`cy@${shop.id}.test`);
  await page.getByLabel("Password").fill("cy-password-12");
  await page.getByRole("button", { name: "Create my help center" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "is taken" })).toBeVisible();

  await page.getByLabel("Link").fill(`${shop.id}-2`);
  await page.getByLabel("Email").fill(shop.email);
  await page.getByRole("button", { name: "Create my help center" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "already has a login" })).toBeVisible();
});
