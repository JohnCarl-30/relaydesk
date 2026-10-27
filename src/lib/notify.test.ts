import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PENDING_TICKET_EMAIL } from "./escalate";
import { newTicketRequest, notifyNewTicket, resendConfig } from "./notify";

describe("resendConfig", () => {
  it("is off without a key", () => {
    assert.equal(resendConfig({}), null);
    assert.equal(resendConfig({ RESEND_API_KEY: "  " }), null);
  });

  it("uses the sender and base URL it's given", () => {
    assert.deepEqual(
      resendConfig({
        RESEND_API_KEY: "re_1",
        RELAYDESK_EMAIL_FROM: "Luma <help@luma.ph>",
        RESEND_BASE_URL: "http://localhost:9/",
      }),
      { apiKey: "re_1", from: "Luma <help@luma.ph>", baseUrl: "http://localhost:9" },
    );
  });
});

describe("newTicketRequest", () => {
  const config = { apiKey: "re_1", from: "Luma <help@luma.ph>", baseUrl: "https://api.resend.com" };
  const input = {
    businessName: "Luma Dental",
    ticket: { id: "tkt_ab12cd34", email: "ana@example.ph", preview: "May discount ba kung 5 kami?" },
    staffEmails: ["owner@luma.ph", "front@luma.ph"],
    origin: "https://help.luma.ph",
  };

  it("mails every staff member a link to the ticket", () => {
    const { url, init } = newTicketRequest(config, input);
    assert.equal(url, "https://api.resend.com/emails");
    assert.equal((init.headers as Record<string, string>).Authorization, "Bearer re_1");
    const body = JSON.parse(init.body as string);
    assert.deepEqual(body.to, ["owner@luma.ph", "front@luma.ph"]);
    assert.equal(body.subject, "New ticket for Luma Dental: May discount ba kung 5 kami?");
    assert.match(body.text, /https:\/\/help\.luma\.ph\/inbox\/tkt_ab12cd34/);
    assert.match(body.text, /Customer: ana@example\.ph/);
  });

  it("says so when the customer hasn't left an email", () => {
    const { init } = newTicketRequest(config, { ...input, ticket: { ...input.ticket, email: PENDING_TICKET_EMAIL } });
    const body = JSON.parse(init.body as string);
    assert.match(body.text, /hasn't left an email yet/);
    assert.doesNotMatch(body.text, new RegExp(PENDING_TICKET_EMAIL));
  });
});

describe("notifyNewTicket", () => {
  it("never mails the demo's made-up staff", async () => {
    const config = { apiKey: "re_1", from: "x@y.z", baseUrl: "http://127.0.0.1:9" };
    const ticket = { id: "tkt_1", email: "a@b.c", preview: "hi" } as Parameters<typeof notifyNewTicket>[0]["ticket"];
    assert.equal(await notifyNewTicket({ businessId: "nimbus", businessName: "Nimbus", ticket, origin: "" }, config), false);
  });
});
