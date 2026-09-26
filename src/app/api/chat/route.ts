import { NextResponse } from "next/server";
import {
  addMessage,
  createConversation,
  createTicket,
  getConversation,
  getTicketByConversation,
  listMessages,
} from "@/lib/db";
import { PENDING_TICKET_EMAIL } from "@/lib/escalate";
import { answerQuestion } from "@/lib/graph";

function ticketEmail(bodyEmail: string | undefined, visitorEmail: string | null): string {
  const fromBody = bodyEmail?.trim().toLowerCase();
  if (fromBody?.includes("@")) return fromBody;
  if (visitorEmail?.includes("@")) return visitorEmail;
  return PENDING_TICKET_EMAIL;
}

function serializeMessages(conversationId: string) {
  return listMessages(conversationId).map((m) => ({
    id: m.id,
    role: m.role,
    body: m.body,
    citations: m.citations ? (JSON.parse(m.citations) as string[]) : [],
    createdAt: m.created_at,
  }));
}

export async function GET(request: Request) {
  const conversationId = new URL(request.url).searchParams.get("conversationId")?.trim();
  if (!conversationId) {
    return NextResponse.json({ error: "conversationId required" }, { status: 400 });
  }
  if (!getConversation(conversationId)) {
    return NextResponse.json({ error: "conversation not found" }, { status: 404 });
  }
  return NextResponse.json({
    conversationId,
    ticketId: getTicketByConversation(conversationId)?.id ?? null,
    messages: serializeMessages(conversationId),
  });
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    conversationId?: string;
    message?: string;
    email?: string;
  };
  const text = body.message?.trim() ?? "";
  if (!text) {
    return NextResponse.json({ error: "message required" }, { status: 400 });
  }

  let conversationId = body.conversationId;
  if (!conversationId || !getConversation(conversationId)) {
    conversationId = createConversation(body.email).id;
  }

  const history = listMessages(conversationId).map(({ role, body: messageBody }) => ({
    role,
    body: messageBody,
  }));
  addMessage(conversationId, "visitor", text);
  const rag = await answerQuestion(text, { history });
  const conversation = getConversation(conversationId);
  let ticket = getTicketByConversation(conversationId);
  let reply = rag.answer;
  if (rag.escalated) {
    if (!ticket) {
      ticket = createTicket(
        conversationId,
        ticketEmail(body.email, conversation?.visitor_email ?? null),
      );
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
    messages: serializeMessages(conversationId),
  });
}
