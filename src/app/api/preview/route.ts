import { NextResponse } from "next/server";
import { z } from "zod";
import { notFound, readBody, unauthorized } from "@/lib/api";
import { currentStaff } from "@/lib/auth";
import { loadHelpCenter } from "@/lib/business";
import { answerQuestion } from "@/lib/graph";

const Preview = z.object({
  message: z.string().trim().min(1).max(2_000),
  history: z
    .array(z.object({ role: z.enum(["visitor", "assistant"]), body: z.string().max(4_000) }))
    .max(20)
    .default([]),
});

/**
 * The setup page's test chat. It answers the way the widget would, from the
 * business's current articles, but saves nothing: no conversation, no ticket.
 */
export async function POST(request: Request) {
  const staff = await currentStaff();
  if (!staff) return unauthorized();
  const center = loadHelpCenter(staff.business_id);
  if (!center) return notFound();
  const body = await readBody(request, Preview);
  if ("error" in body) return body.error;
  const result = await answerQuestion(body.data.message, {
    history: body.data.history,
    helpCenter: center,
  });
  return NextResponse.json({
    reply: result.answer,
    citations: result.citations,
    escalated: result.escalated,
  });
}
