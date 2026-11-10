import { NextResponse } from "next/server";
import { z } from "zod";
import { chatRateLimited, Email, readBody } from "@/lib/api";
import { createTicket, getConversation, listTickets } from "@/lib/db";
import { currentStaff } from "@/lib/auth";

export async function GET() {
  const staff = await currentStaff();
  if (!staff) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ tickets: listTickets(staff.business_id) });
}

const TicketEmail = z.object({
  business: z.string().trim().min(1).max(100),
  conversationId: z.string().trim().min(1).max(100),
  // Staff read this address in the inbox and in the new-ticket email, and replies are sent to it.
  email: Email,
});

/** The widget's "leave an email for the reply" form. Anyone can call it, like the chat. */
export async function POST(request: Request) {
  const limited = chatRateLimited(request, "ticket:");
  if (limited) return limited;
  const body = await readBody(request, TicketEmail);
  if ("error" in body) return body.error;
  const { business, conversationId, email } = body.data;
  if (!getConversation(business, conversationId)) {
    return NextResponse.json({ error: "conversation not found" }, { status: 404 });
  }
  const ticket = createTicket(conversationId, email);
  return NextResponse.json({ ticket });
}
