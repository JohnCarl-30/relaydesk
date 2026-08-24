import { NextResponse } from "next/server";
import { createTicket, getConversation, listTickets } from "@/lib/db";
import { isAdmin } from "@/lib/auth";

export async function GET() {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ tickets: listTickets() });
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    conversationId?: string;
    email?: string;
  };
  const conversationId = body.conversationId?.trim();
  const email = body.email?.trim().toLowerCase();
  if (!conversationId || !email || !email.includes("@")) {
    return NextResponse.json(
      { error: "conversationId and a valid email are required" },
      { status: 400 },
    );
  }
  if (!getConversation(conversationId)) {
    return NextResponse.json({ error: "conversation not found" }, { status: 404 });
  }
  const ticket = createTicket(conversationId, email);
  return NextResponse.json({ ticket });
}
