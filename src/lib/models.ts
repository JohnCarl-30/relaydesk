export type Conversation = {
  id: string;
  visitor_email: string | null;
  created_at: string;
};

export type Message = {
  id: string;
  conversation_id: string;
  role: "visitor" | "assistant" | "agent";
  body: string;
  citations: string | null;
  created_at: string;
};

export type Ticket = {
  id: string;
  conversation_id: string;
  email: string;
  status: "open" | "waiting" | "closed";
  assignee: string | null;
  preview: string;
  created_at: string;
  updated_at: string;
};

export const AGENTS = ["You", "Sam"] as const;
