import { NextResponse } from "next/server";
import { notFound, unauthorized } from "@/lib/api";
import { currentStaff } from "@/lib/auth";
import { removeStaff } from "@/lib/db";

/** Removes a teammate's login. Nobody removes themselves, so a business always keeps one. */
export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const staff = await currentStaff();
  if (!staff) return unauthorized();
  const { id } = await context.params;
  if (id === staff.id) {
    return NextResponse.json({ error: "You can't remove yourself." }, { status: 409 });
  }
  if (!removeStaff(staff.business_id, id)) return notFound();
  return NextResponse.json({ ok: true });
}
