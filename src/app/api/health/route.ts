import { NextResponse } from "next/server";
import { getBusiness } from "@/lib/db";
import { DEMO_BUSINESS_ID } from "@/lib/help-center";

/** For Docker's HEALTHCHECK and uptime monitors: the server answers and the database reads. */
export async function GET() {
  try {
    await getBusiness(DEMO_BUSINESS_ID);
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
