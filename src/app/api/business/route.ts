import { NextResponse } from "next/server";
import { z } from "zod";
import { readBody, unauthorized } from "@/lib/api";
import { currentStaff } from "@/lib/auth";
import { listArticles, setBusinessLive } from "@/lib/db";

/** Go live (or back to hidden). Live needs at least one article to answer from. */
export async function PATCH(request: Request) {
  const staff = await currentStaff();
  if (!staff) return unauthorized();
  const body = await readBody(request, z.object({ live: z.boolean() }));
  if ("error" in body) return body.error;
  if (body.data.live && listArticles(staff.business_id).length === 0) {
    return NextResponse.json(
      { error: "Add at least one article before going live." },
      { status: 409 },
    );
  }
  setBusinessLive(staff.business_id, body.data.live);
  return NextResponse.json({ live: body.data.live });
}
