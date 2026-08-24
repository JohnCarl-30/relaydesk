import { NextResponse } from "next/server";
import { replyToTicket } from "@/lib/db";
import { isAdmin } from "@/lib/auth";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await context.params;
  const body = (await request.json()) as { body?: string };
  const text = body.body?.trim() ?? "";
  if (!text) {
    return NextResponse.json({ error: "body required" }, { status: 400 });
  }
  const ticket = replyToTicket(id, text);
  if (!ticket) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ ticket });
}
