import { NextResponse } from "next/server";
import {
  addMessage,
  createConversation,
  getConversation,
  getTicketByConversation,
  listMessages,
} from "@/lib/db";
import { answerQuestion } from "@/lib/rag";

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

  addMessage(conversationId, "visitor", text);
  const rag = await answerQuestion(text);
  addMessage(
    conversationId,
    "assistant",
    rag.answer,
    rag.citations.map((c) => c.title),
  );

  return NextResponse.json({
    conversationId,
    reply: rag.answer,
    citations: rag.citations,
    confident: rag.confident,
    usedLlm: rag.usedLlm,
    messages: serializeMessages(conversationId),
  });
}
