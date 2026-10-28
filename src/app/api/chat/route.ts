import { after, NextResponse } from "next/server";
import {
  addMessage,
  createConversation,
  createTicket,
  getConversation,
  getTicketByConversation,
  listMessages,
} from "@/lib/db";
import { loadLiveHelpCenter, type HelpCenter } from "@/lib/business";
import { runCopilot } from "@/lib/copilot";
import { PENDING_TICKET_EMAIL } from "@/lib/escalate";
import { answerQuestion } from "@/lib/graph";
import { slugForTitle } from "@/lib/help-center";
import { notifyNewTicket } from "@/lib/notify";
import { publicOrigin } from "@/lib/origin";
import { parseChannel } from "@/lib/voice";

/*
 * The widget's API. Every call names the business whose widget sent it, and a
 * conversation id only resolves inside that business.
 */

function ticketEmail(bodyEmail: string | undefined, visitorEmail: string | null): string {
  const fromBody = bodyEmail?.trim().toLowerCase();
  if (fromBody?.includes("@")) return fromBody;
  if (visitorEmail?.includes("@")) return visitorEmail;
  return PENDING_TICKET_EMAIL;
}

function serializeMessages(center: HelpCenter, conversationId: string) {
  return listMessages(conversationId).map((m) => ({
    id: m.id,
    role: m.role,
    body: m.body,
    citations: (m.citations ? (JSON.parse(m.citations) as string[]) : []).map((title) => ({
      title,
      slug: slugForTitle(center, title),
    })),
    createdAt: m.created_at,
  }));
}

function unknownBusiness(business: string | undefined) {
  return NextResponse.json(
    { error: business ? "business not found" : "business required" },
    { status: business ? 404 : 400 },
  );
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const business = params.get("business")?.trim();
  const center = business ? loadLiveHelpCenter(business) : undefined;
  if (!center) return unknownBusiness(business);
  const conversationId = params.get("conversationId")?.trim();
  if (!conversationId) {
    return NextResponse.json({ error: "conversationId required" }, { status: 400 });
  }
  if (!getConversation(center.businessId, conversationId)) {
    return NextResponse.json({ error: "conversation not found" }, { status: 404 });
  }
  return NextResponse.json({
    conversationId,
    ticketId: getTicketByConversation(conversationId)?.id ?? null,
    messages: serializeMessages(center, conversationId),
  });
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    business?: string;
    conversationId?: string;
    message?: string;
    email?: string;
    /** "voice" when the widget transcribed the message from speech. */
    channel?: string;
  };
  const business = body.business?.trim();
  const center = business ? loadLiveHelpCenter(business) : undefined;
  if (!center) return unknownBusiness(business);
  const businessId = center.businessId;
  const text = body.message?.trim() ?? "";
  if (!text) {
    return NextResponse.json({ error: "message required" }, { status: 400 });
  }

  let conversationId = body.conversationId;
  if (!conversationId || !getConversation(businessId, conversationId)) {
    conversationId = createConversation(businessId, body.email).id;
  }

  const history = listMessages(conversationId).map(({ role, body: messageBody }) => ({
    role,
    body: messageBody,
  }));
  addMessage(conversationId, "visitor", text);
  const rag = await answerQuestion(text, {
    history,
    sessionId: conversationId,
    helpCenter: center,
    channel: parseChannel(body.channel),
  });
  const conversation = getConversation(businessId, conversationId);
  let ticket = getTicketByConversation(conversationId);
  let reply = rag.answer;
  if (rag.escalated) {
    if (!ticket) {
      const created = createTicket(
        conversationId,
        ticketEmail(body.email, conversation?.visitor_email ?? null),
      );
      ticket = created;
      // Draft after the response is sent, so the visitor never waits on it.
      after(async () => {
        await notifyNewTicket({
          businessId,
          businessName: center.name,
          ticket: created,
          origin: await publicOrigin(),
        });
        await runCopilot(businessId, created.id, "ticket_created");
      });
    }
    if (ticket) {
      reply = `${rag.answer}\n\nTicket ${ticket.id} is in the staff inbox.`;
    }
  }
  addMessage(
    conversationId,
    "assistant",
    reply,
    rag.citations.map((c) => c.title),
  );

  return NextResponse.json({
    conversationId,
    reply,
    citations: rag.citations,
    confident: rag.confident,
    usedLlm: rag.usedLlm,
    escalated: rag.escalated,
    ticketId: ticket?.id ?? null,
    messages: serializeMessages(center, conversationId),
  });
}
