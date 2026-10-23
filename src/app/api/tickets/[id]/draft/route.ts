import { NextResponse } from "next/server";
import { currentStaff } from "@/lib/auth";
import { runCopilot } from "@/lib/copilot";
import { getTicket } from "@/lib/db";

/** Regenerate: run the co-pilot on this ticket now. */
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const staff = await currentStaff();
  if (!staff) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await context.params;
  if (!getTicket(staff.business_id, id)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const result = await runCopilot(staff.business_id, id, "regenerate");
  return NextResponse.json(result);
}
