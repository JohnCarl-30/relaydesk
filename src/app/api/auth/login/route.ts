import { NextResponse } from "next/server";
import { cameOverHttps, startSession } from "@/lib/auth";
import { checkStaffLogin } from "@/lib/db";

export async function POST(request: Request) {
  const body = (await request.json()) as { email?: string; password?: string };
  const staff = checkStaffLogin(body.email ?? "", body.password ?? "");
  if (!staff) {
    return NextResponse.json({ error: "wrong email or password" }, { status: 401 });
  }
  await startSession(staff, { secure: cameOverHttps(request) });
  return NextResponse.json({ ok: true });
}
