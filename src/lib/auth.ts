import { cookies } from "next/headers";
import { getStaff, sessionSecret, type Staff } from "@/lib/db";
import { decodeSession, encodeSession, SESSION_TTL_MS } from "@/lib/session";

const COOKIE = "relaydesk_session";

/** The signed-in staff member, whose business_id scopes everything the inbox shows. */
export async function currentStaff(): Promise<Staff | null> {
  const jar = await cookies();
  const session = decodeSession(jar.get(COOKIE)?.value, sessionSecret());
  if (!session) return null;
  return getStaff(session.businessId, session.staffId) ?? null;
}

/** True when the browser reached us over https, directly or through a TLS proxy. */
export function cameOverHttps(request: Request): boolean {
  return (
    new URL(request.url).protocol === "https:" ||
    request.headers.get("x-forwarded-proto") === "https"
  );
}

export async function startSession(staff: Staff, options: { secure: boolean }) {
  const jar = await cookies();
  const value = encodeSession(
    { staffId: staff.id, businessId: staff.business_id, expiresAt: Date.now() + SESSION_TTL_MS },
    sessionSecret(),
  );
  jar.set(COOKIE, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: options.secure,
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export async function endSession() {
  const jar = await cookies();
  jar.delete(COOKIE);
}
