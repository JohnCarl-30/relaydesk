import { cookies } from "next/headers";

const COOKIE = "relaydesk_admin";

export function adminPassword(): string {
  return process.env.RELAYDESK_ADMIN_PASSWORD ?? "nimbus-demo";
}

export async function isAdmin(): Promise<boolean> {
  const jar = await cookies();
  return jar.get(COOKIE)?.value === "1";
}

export async function setAdminCookie() {
  const jar = await cookies();
  jar.set(COOKIE, "1", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
}

export async function clearAdminCookie() {
  const jar = await cookies();
  jar.delete(COOKIE);
}
