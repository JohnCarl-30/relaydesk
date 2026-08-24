import { NextResponse } from "next/server";
import { getTicket, listMessages } from "@/lib/db";
import { isAdmin } from "@/lib/auth";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await context.params;
  const ticket = getTicket(id);
  if (!ticket) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const messages = listMessages(ticket.conversation_id);
  return NextResponse.json({ ticket, messages });
}
