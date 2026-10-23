import { NextResponse } from "next/server";
import { z } from "zod";
import { readBody, unauthorized } from "@/lib/api";
import { currentStaff } from "@/lib/auth";
import { createMcpToken } from "@/lib/db";
import { publicOrigin } from "@/lib/origin";

/** Makes a token for connecting an MCP client. The token is in this response only. */
export async function POST(request: Request) {
  const staff = await currentStaff();
  if (!staff) return unauthorized();
  const body = await readBody(request, z.object({ name: z.string().trim().min(1).max(80) }));
  if ("error" in body) return body.error;
  const { token, row } = createMcpToken({
    businessId: staff.business_id,
    name: body.data.name,
    createdBy: staff.id,
  });
  return NextResponse.json({ token, id: row.id, url: `${await publicOrigin()}/api/mcp` });
}
