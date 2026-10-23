import { NextResponse } from "next/server";
import { notFound, unauthorized } from "@/lib/api";
import { currentStaff } from "@/lib/auth";
import { revokeInvite } from "@/lib/db";

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const staff = await currentStaff();
  if (!staff) return unauthorized();
  const { id } = await context.params;
  if (!revokeInvite(staff.business_id, id)) return notFound();
  return NextResponse.json({ ok: true });
}
