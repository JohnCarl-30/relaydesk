import { NextResponse } from "next/server";
import { z } from "zod";
import { Password, PersonName, readBody } from "@/lib/api";
import { cameOverHttps, startSession } from "@/lib/auth";
import { acceptInvite, findInvite, getStaffByEmail } from "@/lib/db";

const Accept = z.object({ token: z.string().min(1), name: PersonName, password: Password });

export async function POST(request: Request) {
  const body = await readBody(request, Accept);
  if ("error" in body) return body.error;
  const invite = findInvite(body.data.token);
  if (!invite) {
    return NextResponse.json({ error: "This invite link is used, expired, or wrong." }, { status: 404 });
  }
  if (getStaffByEmail(invite.email)) {
    return NextResponse.json({ error: "That email already has a login. Sign in instead." }, { status: 409 });
  }
  const staff = acceptInvite(body.data.token, { name: body.data.name, password: body.data.password });
  await startSession(staff, { secure: cameOverHttps(request) });
  return NextResponse.json({ ok: true });
}
