import { NextResponse } from "next/server";
import { getTicket, listMessages, listStaff, updateTicket } from "@/lib/db";
import { currentStaff } from "@/lib/auth";
import type { Ticket } from "@/lib/models";

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
  const body = (await request.json()) as {
    status?: Ticket["status"];
    assignee?: string | null;
  };

  const patch: { status?: Ticket["status"]; assignee?: string | null } = {};
  if (body.status !== undefined) {
    if (body.status !== "open" && body.status !== "waiting" && body.status !== "closed") {
      return NextResponse.json({ error: "bad status" }, { status: 400 });
    }
    patch.status = body.status;
  }
  if (body.assignee !== undefined) {
    const names = listStaff(staff.business_id).map((member) => member.name);
    if (body.assignee !== null && !names.includes(body.assignee)) {
      return NextResponse.json({ error: "bad assignee" }, { status: 400 });
    }
    patch.assignee = body.assignee;
  }

  const ticket = updateTicket(staff.business_id, id, patch);
  if (!ticket) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ ticket });
}
