import { timingSafeEqual } from "node:crypto";
import { countMcpTokens, redeemMcpToken } from "./db";
import { DEMO_BUSINESS_ID } from "./help-center";

/**
 * Who an MCP request is for. A business's own tokens (made on its Setup page)
 * scope every tool to that business. RELAYDESK_MCP_TOKEN, if set, is the
 * Nimbus demo's token. With neither, the endpoint is off.
 */
export function authenticateMcp(
  authorization: string | null,
): { businessId: string } | "off" | "unauthorized" {
  const demoToken = process.env.RELAYDESK_MCP_TOKEN;
  if (!demoToken && countMcpTokens() === 0) return "off";
  const token = authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token) return "unauthorized";
  if (demoToken && sameSecret(token, demoToken)) return { businessId: DEMO_BUSINESS_ID };
  const found = redeemMcpToken(token);
  return found ? { businessId: found.businessId } : "unauthorized";
}

function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
