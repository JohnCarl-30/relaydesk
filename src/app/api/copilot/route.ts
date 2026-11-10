import { NextResponse } from "next/server";
import { z } from "zod";
import { demoReadOnly, readBody, unauthorized } from "@/lib/api";
import { currentStaff } from "@/lib/auth";
import { COPILOT_SETTING, copilotEnabled } from "@/lib/copilot";
import { isPublicDemo, setSetting } from "@/lib/db";

/** The co-pilot's on/off switch. Off stops new drafts; pending ones stay reviewable. */
export async function POST(request: Request) {
  const staff = await currentStaff();
  if (!staff) return unauthorized();
  if (isPublicDemo(staff)) return demoReadOnly();
  const body = await readBody(request, z.object({ enabled: z.boolean() }));
  if ("error" in body) return body.error;
  setSetting(staff.business_id, COPILOT_SETTING, body.data.enabled ? "on" : "off");
  return NextResponse.json({ enabled: copilotEnabled(staff.business_id) });
}
