import { NextResponse } from "next/server";
import { z } from "zod";
import { Email, readBody, unauthorized } from "@/lib/api";
import { currentStaff } from "@/lib/auth";
import { createInvite, getStaffByEmail } from "@/lib/db";
import { publicOrigin } from "@/lib/origin";

/** Invites a teammate. There's no email sending yet, so the link comes back to copy. */
export async function POST(request: Request) {
  const staff = await currentStaff();
  if (!staff) return unauthorized();
  const body = await readBody(request, z.object({ email: Email }));
  if ("error" in body) return body.error;
  if (getStaffByEmail(body.data.email)) {
    return NextResponse.json({ error: "That email already has a login." }, { status: 409 });
  }
  const { invite, token } = createInvite({
    businessId: staff.business_id,
    email: body.data.email,
    invitedBy: staff.id,
  });
  return NextResponse.json({ invite, link: `${await publicOrigin()}/invite/${token}` });
}
