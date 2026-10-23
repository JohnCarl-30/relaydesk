import { NextResponse } from "next/server";
import { db } from "@/lib/db";

/** For Docker's HEALTHCHECK and uptime monitors: the server answers and the database reads. */
export async function GET() {
  try {
    db().prepare("SELECT 1 FROM businesses LIMIT 1").get();
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
