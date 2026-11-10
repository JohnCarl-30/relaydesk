import { NextResponse } from "next/server";
import { z } from "zod";
import { readBody } from "@/lib/api";
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
  // checkTicketPatch does the checking; this is for the size limit.
  const body = await readBody(request, z.object({ status: z.unknown().optional(), assignee: z.unknown().optional() }));
  if ("error" in body) return body.error;
  const checked = checkTicketPatch(staff.business_id, body.data);
  if ("error" in checked) {
    return NextResponse.json({ error: checked.error }, { status: 400 });
  }

  const ticket = updateTicket(staff.business_id, id, checked.patch);
  if (!ticket) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ ticket });
}
