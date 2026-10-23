import { NextResponse } from "next/server";
import { notFound, unauthorized } from "@/lib/api";
import { currentStaff } from "@/lib/auth";
import { revokeMcpToken } from "@/lib/db";

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const staff = await currentStaff();
  if (!staff) return unauthorized();
  const { id } = await context.params;
  if (!revokeMcpToken(staff.business_id, id)) return notFound();
  return NextResponse.json({ ok: true });
}
