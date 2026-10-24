import { NextResponse } from "next/server";
import { z } from "zod";
import { readBody, unauthorized } from "@/lib/api";
import { currentStaff } from "@/lib/auth";
import { loadLiveHelpCenter } from "@/lib/business";
import { setVoiceProvider, voiceStatus } from "@/lib/server-voice";

/** Which voice the widget should use. Public: the widget asks when it opens. */
export async function GET(request: Request) {
  const business = new URL(request.url).searchParams.get("business")?.trim();
  const center = business ? loadLiveHelpCenter(business) : undefined;
  if (!center) return NextResponse.json({ error: "business not found" }, { status: 404 });
  return NextResponse.json({ provider: voiceStatus(center.businessId).provider });
}

/** Setup's switch between the browser's voice and ElevenLabs. */
export async function POST(request: Request) {
  const staff = await currentStaff();
  if (!staff) return unauthorized();
  const body = await readBody(request, z.object({ provider: z.enum(["browser", "elevenlabs"]) }));
  if ("error" in body) return body.error;
  if (body.data.provider === "elevenlabs" && !voiceStatus(staff.business_id).configured) {
    return NextResponse.json(
      { error: "Set ELEVENLABS_API_KEY on the server first." },
      { status: 409 },
    );
  }
  setVoiceProvider(staff.business_id, body.data.provider);
  return NextResponse.json(voiceStatus(staff.business_id));
}
