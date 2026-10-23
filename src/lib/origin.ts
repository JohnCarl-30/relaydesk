import { headers } from "next/headers";

/**
 * The address businesses paste into their sites and staff open invites at.
 * RELAYDESK_PUBLIC_URL wins, since a proxy's Host header is not always the public one.
 */
export async function publicOrigin(): Promise<string> {
  const fromEnv = process.env.RELAYDESK_PUBLIC_URL?.replace(/\/+$/, "");
  if (fromEnv) return fromEnv;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}

export function embedSnippet(origin: string, businessId: string): string {
  return `<script src="${origin}/embed.js" data-business="${businessId}" async></script>`;
}
