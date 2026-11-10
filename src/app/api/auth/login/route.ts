import { NextResponse } from "next/server";
import { z } from "zod";
import { authRateLimited, readBody } from "@/lib/api";
import { cameOverHttps, startSession } from "@/lib/auth";
import { checkStaffLogin } from "@/lib/db";

// Capped because the password goes through scrypt, which blocks the server while it runs.
const Login = z.object({ email: z.string().max(200), password: z.string().max(200) });

export async function POST(request: Request) {
  const limited = authRateLimited(request);
  if (limited) return limited;
  const body = await readBody(request, Login);
  if ("error" in body) return body.error;
  const staff = checkStaffLogin(body.data.email, body.data.password);
  if (!staff) {
    return NextResponse.json({ error: "wrong email or password" }, { status: 401 });
  }
  await startSession(staff, { secure: cameOverHttps(request) });
  return NextResponse.json({ ok: true });
}
