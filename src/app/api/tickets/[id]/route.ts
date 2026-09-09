import { NextResponse } from "next/server";
import { getTicket, listMessages, updateTicket } from "@/lib/db";
import { isAdmin } from "@/lib/auth";
import { AGENTS, type Ticket } from "@/lib/models";

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

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!(await isAdmin())) {
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
    if (body.assignee !== null && !AGENTS.includes(body.assignee as (typeof AGENTS)[number])) {
      return NextResponse.json({ error: "bad assignee" }, { status: 400 });
    }
    patch.assignee = body.assignee;
  }

  const ticket = updateTicket(id, patch);
  if (!ticket) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ ticket });
}
