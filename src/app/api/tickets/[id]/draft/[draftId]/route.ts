import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { decideDraft, getDraft, replyToTicket } from "@/lib/db";

const REJECT_REASONS = ["wrong", "not_helpful", "tone", "other"] as const;

/**
 * The only path from a co-pilot draft to the customer. Staff send it as is or
 * edited (it goes through the same replyToTicket as a typed reply), or reject it.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; draftId: string }> },
) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id, draftId } = await context.params;
  const draft = getDraft(draftId);
  if (!draft || draft.ticket_id !== id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (draft.status !== "pending") {
    return NextResponse.json({ error: `draft is ${draft.status}` }, { status: 409 });
  }

  const body = (await request.json()) as { action?: string; body?: string; reason?: string };
  if (body.action === "send") {
    const finalBody = body.body?.trim() || draft.body;
    const ticket = replyToTicket(id, finalBody);
    if (!ticket) return NextResponse.json({ error: "not found" }, { status: 404 });
    decideDraft(draft.id, {
      status: finalBody === draft.body ? "sent" : "edited",
      finalBody,
    });
    return NextResponse.json({ ticket });
  }
  if (body.action === "reject") {
    const reason = REJECT_REASONS.find((r) => r === body.reason) ?? "other";
    decideDraft(draft.id, { status: "rejected", rejectReason: reason });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "action must be send or reject" }, { status: 400 });
}
