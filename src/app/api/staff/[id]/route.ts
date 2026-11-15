import { NextResponse } from "next/server";
import { demoReadOnly, notFound, unauthorized } from "@/lib/api";
import { currentStaff } from "@/lib/auth";
import { isOwner, isPublicDemo, removeStaff } from "@/lib/db";

/** Removes a teammate's login. Nobody removes themselves, so a business always keeps one. */
export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const staff = await currentStaff();
  if (!staff) return unauthorized();
  if (isPublicDemo(staff)) return demoReadOnly();
  if (!isOwner(staff)) {
    return NextResponse.json({ error: "Only the person who set up this business can remove teammates." }, { status: 403 });
  }
  const { id } = await context.params;
  if (id === staff.id) {
    return NextResponse.json({ error: "You can't remove yourself." }, { status: 409 });
  }
  if (!removeStaff(staff.business_id, id)) return notFound();
  return NextResponse.json({ ok: true });
}
