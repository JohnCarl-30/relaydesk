import { after, NextResponse } from "next/server";
import { z } from "zod";
import { readBody } from "@/lib/api";
import { currentStaff } from "@/lib/auth";
import { decideDraft, getBusiness, getDraft, sendDraft } from "@/lib/db";
import { notifyCustomerReply } from "@/lib/notify";

const REJECT_REASONS = ["wrong", "not_helpful", "tone", "other"] as const;

const Decision = z.object({
  action: z.enum(["send", "reject"], "action must be send or reject"),
  body: z.string().max(10_000).optional(),
  reason: z.string().max(40).optional(),
});

/**
 * The only path from a co-pilot draft to the customer. Staff send it as is or
 * edited (it goes through the same replyToTicket as a typed reply), or reject it.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; draftId: string }> },
) {
  const staff = await currentStaff();
  if (!staff) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id, draftId } = await context.params;
  const draft = getDraft(staff.business_id, draftId);
  if (!draft || draft.ticket_id !== id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (draft.status !== "pending") {
    return NextResponse.json({ error: `draft is ${draft.status}` }, { status: 409 });
  }

  const read = await readBody(request, Decision);
  if ("error" in read) return read.error;
  const body = read.data;
  if (body.action === "send") {
    const finalBody = body.body?.trim() || draft.body;
    // Of two clicks that both read "pending" above, only one sends.
    const ticket = sendDraft(staff.business_id, draft, finalBody, staff.name);
    if (!ticket) return NextResponse.json({ error: "draft is already decided" }, { status: 409 });
    const businessName = getBusiness(staff.business_id)?.name ?? staff.business_id;
    after(() => notifyCustomerReply({ businessId: staff.business_id, businessName, ticket, body: finalBody }));
    return NextResponse.json({ ticket });
  }
  const reason = REJECT_REASONS.find((r) => r === body.reason) ?? "other";
  if (!decideDraft(draft.id, { status: "rejected", rejectReason: reason })) {
    return NextResponse.json({ error: "draft is already decided" }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}
