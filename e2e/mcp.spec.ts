import { expect, test, type APIRequestContext } from "@playwright/test";
import { ask, openChat, signIn } from "./chat";
import { ACME, MCP_TOKEN } from "./env";

let nextId = 1;

/** One JSON-RPC call to /api/mcp, the way an MCP client sends it. */
async function rpc(request: APIRequestContext, token: string | null, method: string, params: object = {}) {
  const res = await request.post("/api/mcp", {
    headers: {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    data: { jsonrpc: "2.0", id: nextId++, method, params },
  });
  return res;
}

async function tool(request: APIRequestContext, token: string, name: string, args: object) {
  const res = await rpc(request, token, "tools/call", { name, arguments: args });
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { result: { isError?: boolean; content: { text: string }[] } };
  return body.result;
}

test("the MCP endpoint wants a bearer token", async ({ request }) => {
  expect((await rpc(request, null, "tools/list")).status()).toBe(401);
  const wrong = await rpc(request, "not-the-token", "tools/list");
  expect(wrong.status()).toBe(401);
  expect(wrong.headers()["www-authenticate"]).toContain("Bearer");
});

test("an agent drafts over MCP and staff send it from the inbox", async ({ page, request }) => {
  const init = await rpc(request, MCP_TOKEN, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "e2e", version: "1" },
  });
  expect(init.status()).toBe(200);
  expect(((await init.json()) as { result: { serverInfo: { name: string } } }).result.serverInfo.name).toBe("relaydesk");

  await page.goto("/");
  await openChat(page);
  const reply = await ask(page, "How do I connect Nimbus to Salesforce?");
  const ticketId = reply.ticketId!;

  const listed = await tool(request, MCP_TOKEN, "list_tickets", { status: "open" });
  expect(listed.content[0].text).toContain(ticketId);
  const search = await tool(request, MCP_TOKEN, "search_help_center", { query: "API keys" });
  expect(search.content[0].text).toContain('"slug": "api-keys"');
  const drafted = await tool(request, MCP_TOKEN, "draft_reply", {
    ticket_id: ticketId,
    body: "Hi there, we don't have a Salesforce integration yet. You can export events with the API keys described in our docs.",
    rationale: "No integration article; pointed to API keys.",
    citations: ["api-keys"],
  });
  expect(drafted.isError).toBeFalsy();

  await signIn(page);
  const card = page.getByRole("region", { name: "Suggested reply" });
  await page.goto(`/inbox/${ticketId}`);
  await expect(card.getByRole("textbox", { name: "Suggested reply text" })).toHaveValue(/Salesforce integration yet/);
  await card.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.locator("ol").getByText(/Salesforce integration yet/)).toBeVisible();
});

test("a business's own token only reaches its own inbox", async ({ page, request }) => {
  await signIn(page, ACME.email, ACME.password);
  await page.goto("/inbox/setup");
  await page.getByLabel("Token name").fill("Claude for Acme");
  await page.getByRole("button", { name: "Create token" }).click();
  const token = await page.getByLabel("MCP token").inputValue();
  await expect(page.getByLabel("Claude Code command")).toHaveValue(
    new RegExp(`^claude mcp add --transport http relaydesk http://.+/api/mcp --header "Authorization: Bearer ${token}"$`),
  );

  const nimbus = await tool(request, token, "get_ticket", { ticket_id: "tkt_seats" });
  expect(nimbus.isError).toBe(true);
  const delivery = await tool(request, token, "search_help_center", { query: "delivery outside Metro Manila" });
  expect(delivery.content[0].text).toContain("delivery-areas");

  await page.getByRole("button", { name: "Revoke Claude for Acme" }).click();
  await expect(page.getByRole("button", { name: "Revoke Claude for Acme" })).toHaveCount(0);
  expect((await rpc(request, token, "tools/list")).status()).toBe(401);
});
