import { after, NextResponse } from "next/server";
import { getBusiness, replyToTicket } from "@/lib/db";
import { currentStaff } from "@/lib/auth";
import { notifyCustomerReply } from "@/lib/notify";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const staff = await currentStaff();
  if (!staff) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await context.params;
  const body = (await request.json()) as { body?: string };
  const text = body.body?.trim() ?? "";
  if (!text) {
    return NextResponse.json({ error: "body required" }, { status: 400 });
  }
  const ticket = replyToTicket(staff.business_id, id, text, staff.name);
  if (!ticket) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const businessName = getBusiness(staff.business_id)?.name ?? staff.business_id;
  after(() => notifyCustomerReply({ businessId: staff.business_id, businessName, ticket, body: text }));
  return NextResponse.json({ ticket });
}
