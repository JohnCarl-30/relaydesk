import { createHmac, timingSafeEqual } from "node:crypto";

/*
 * Staff sessions. The cookie names the staff member and their business and is
 * signed, so editing it (say, to another business's id) breaks the signature.
 */

export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;

export type Session = {
  staffId: string;
  businessId: string;
  expiresAt: number;
};

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function encodeSession(session: Session, secret: string): string {
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

export function decodeSession(
  value: string | undefined,
  secret: string,
  now = Date.now(),
): Session | null {
  if (!value) return null;
  const [payload, signature] = value.split(".");
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(payload, secret));
  const actual = Buffer.from(signature);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString()) as Session;
    if (typeof session.staffId !== "string" || typeof session.businessId !== "string") return null;
    if (typeof session.expiresAt !== "number" || session.expiresAt <= now) return null;
    return session;
  } catch {
    return null;
  }
}
