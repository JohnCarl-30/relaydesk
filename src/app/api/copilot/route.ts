import { NextResponse } from "next/server";
import { currentStaff } from "@/lib/auth";
import { COPILOT_SETTING, copilotEnabled } from "@/lib/copilot";
import { setSetting } from "@/lib/db";

/** The co-pilot's on/off switch. Off stops new drafts; pending ones stay reviewable. */
export async function POST(request: Request) {
  const staff = await currentStaff();
  if (!staff) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await request.json()) as { enabled?: unknown };
  if (typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "enabled must be true or false" }, { status: 400 });
  }
  setSetting(staff.business_id, COPILOT_SETTING, body.enabled ? "on" : "off");
  return NextResponse.json({ enabled: copilotEnabled(staff.business_id) });
}
