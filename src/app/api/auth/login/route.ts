import { NextResponse } from "next/server";
import { adminPassword, setAdminCookie } from "@/lib/auth";

export async function POST(request: Request) {
  const body = (await request.json()) as { password?: string };
  if ((body.password ?? "") !== adminPassword()) {
    return NextResponse.json({ error: "wrong password" }, { status: 401 });
  }
  await setAdminCookie();
  return NextResponse.json({ ok: true });
}
