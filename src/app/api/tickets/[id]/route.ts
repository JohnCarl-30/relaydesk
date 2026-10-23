import { NextResponse } from "next/server";
import { getTicket, listMessages, updateTicket } from "@/lib/db";
import { checkTicketPatch } from "@/lib/ticket-patch";
import { currentStaff } from "@/lib/auth";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const staff = await currentStaff();
  if (!staff) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await context.params;
  const ticket = getTicket(staff.business_id, id);
  if (!ticket) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const messages = listMessages(ticket.conversation_id);
  return NextResponse.json({ ticket, messages });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const staff = await currentStaff();
  if (!staff) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await context.params;
  const body = (await request.json()) as { status?: unknown; assignee?: unknown };
  const checked = checkTicketPatch(staff.business_id, body);
  if ("error" in checked) {
    return NextResponse.json({ error: checked.error }, { status: 400 });
  }

  const ticket = updateTicket(staff.business_id, id, checked.patch);
  if (!ticket) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ ticket });
}
