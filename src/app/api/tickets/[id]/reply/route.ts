import { after, NextResponse } from "next/server";
import { z } from "zod";
import { readBody } from "@/lib/api";
import { getBusiness, replyToTicket } from "@/lib/db";
import { currentStaff } from "@/lib/auth";
import { notifyCustomerReply } from "@/lib/notify";

/** A reply is saved, shown in the widget and emailed, so it has a length a person would write. */
const Reply = z.string().trim().min(1, "write a reply first").max(10_000);

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const staff = await currentStaff();
  if (!staff) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await context.params;
  const body = await readBody(request, z.object({ body: Reply }));
  if ("error" in body) return body.error;
  const text = body.data.body;
  const ticket = replyToTicket(staff.business_id, id, text, staff.name);
  if (!ticket) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const businessName = getBusiness(staff.business_id)?.name ?? staff.business_id;
  after(() => notifyCustomerReply({ businessId: staff.business_id, businessName, ticket, body: text }));
  return NextResponse.json({ ticket });
}
