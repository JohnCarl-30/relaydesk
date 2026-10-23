import { NextResponse } from "next/server";
import { createTicket, getConversation, listTickets } from "@/lib/db";
import { currentStaff } from "@/lib/auth";

export async function GET() {
  const staff = await currentStaff();
  if (!staff) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ tickets: listTickets(staff.business_id) });
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    business?: string;
    conversationId?: string;
    email?: string;
  };
  const business = body.business?.trim();
  const conversationId = body.conversationId?.trim();
  const email = body.email?.trim().toLowerCase();
  if (!business || !conversationId || !email || !email.includes("@")) {
    return NextResponse.json(
      { error: "business, conversationId and a valid email are required" },
      { status: 400 },
    );
  }
  if (!getConversation(business, conversationId)) {
    return NextResponse.json({ error: "conversation not found" }, { status: 404 });
  }
  const ticket = createTicket(conversationId, email);
  return NextResponse.json({ ticket });
}
