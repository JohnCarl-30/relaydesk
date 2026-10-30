/*
 * Emails a business's staff when Relaydesk opens a ticket, through Resend.
 * Optional: without RESEND_API_KEY tickets still land in /inbox, just quietly.
 */
import { DEMO_BUSINESS_ID } from "./help-center";
import { listStaff } from "./db";
import { PENDING_TICKET_EMAIL } from "./escalate";
import type { Ticket } from "./models";

export type ResendConfig = { apiKey: string; from: string; baseUrl: string };

export function resendConfig(env: Record<string, string | undefined> = process.env): ResendConfig | null {
  const apiKey = env.RESEND_API_KEY?.trim();
  if (!apiKey) return null;
  return {
    apiKey,
    // Resend's test sender only delivers to the Resend account's own address. Set a verified domain's sender for real use.
    from: env.RELAYDESK_EMAIL_FROM?.trim() || "Relaydesk <onboarding@resend.dev>",
    baseUrl: (env.RESEND_BASE_URL?.trim() || "https://api.resend.com").replace(/\/+$/, ""),
  };
}

/** The Resend call that tells staff about a new ticket. */
export function newTicketRequest(
  config: ResendConfig,
  input: { businessName: string; ticket: Pick<Ticket, "id" | "email" | "preview">; staffEmails: string[]; origin: string },
): { url: string; init: RequestInit } {
  const { ticket } = input;
  const customer =
    ticket.email === PENDING_TICKET_EMAIL ? "The customer hasn't left an email yet." : `Customer: ${ticket.email}`;
  const text = [
    `Relaydesk passed this question to your team:`,
    ``,
    `"${ticket.preview}"`,
    ``,
    customer,
    ``,
    `Open the ticket: ${input.origin}/inbox/${ticket.id}`,
  ].join("\n");
  return {
    url: `${config.baseUrl}/emails`,
    init: {
      method: "POST",
      headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: config.from,
        // Teammates already see each other's addresses on the Team page.
        to: input.staffEmails,
        subject: `New ticket for ${input.businessName}: ${ticket.preview.slice(0, 60)}`,
        text,
      }),
    },
  };
}

/** Sends the new-ticket email. Never throws: a mail outage must not break the chat. */
export async function notifyNewTicket(
  input: { businessId: string; businessName: string; ticket: Ticket; origin: string },
  config = resendConfig(),
): Promise<boolean> {
  // The demo's staff address is made up, and bounces hurt the sender's reputation.
  if (!config || input.businessId === DEMO_BUSINESS_ID) return false;
  const staffEmails = listStaff(input.businessId).map((s) => s.email);
  if (!staffEmails.length) return false;
  const { url, init } = newTicketRequest(config, { ...input, staffEmails });
  const res = await fetch(url, init).catch((error: unknown) => error as Error);
  if (res instanceof Response && res.ok) return true;
  console.error("ticket email failed", res instanceof Response ? `${res.status} ${await res.text()}` : res);
  return false;
}

/** The Resend call that sends a staff reply to the customer who asked. */
export function replyRequest(
  config: ResendConfig,
  input: { businessName: string; ticket: Pick<Ticket, "email" | "preview">; body: string },
): { url: string; init: RequestInit } {
  const { ticket } = input;
  const text = [input.body, ``, `---`, `You asked ${input.businessName}: "${ticket.preview}"`].join("\n");
  return {
    url: `${config.baseUrl}/emails`,
    init: {
      method: "POST",
      headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: config.from,
        to: [ticket.email],
        subject: `${input.businessName} replied: ${ticket.preview.slice(0, 60)}`,
        text,
      }),
    },
  };
}

/** Emails a staff reply to the customer, if they left an email. Never throws: the reply is already in the chat. */
export async function notifyCustomerReply(
  input: { businessId: string; businessName: string; ticket: Ticket; body: string },
  config = resendConfig(),
): Promise<boolean> {
  // Demo tickets carry made-up customer addresses.
  if (!config || input.businessId === DEMO_BUSINESS_ID || input.ticket.email === PENDING_TICKET_EMAIL) return false;
  const { url, init } = replyRequest(config, input);
  const res = await fetch(url, init).catch((error: unknown) => error as Error);
  if (res instanceof Response && res.ok) return true;
  console.error("reply email failed", res instanceof Response ? `${res.status} ${await res.text()}` : res);
  return false;
}
