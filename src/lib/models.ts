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
  /** Help-center category the co-pilot filed it under. */
  topic: string | null;
  /** The customer's question in one line, written by the co-pilot. */
  summary: string | null;
  /** Why a person has to answer; null once staff reply. */
  needs_human_reason: string | null;
  /** 1 when a co-pilot draft is waiting for review (listTickets only). */
  has_draft?: number;
};

/** "answer" is grounded in help articles; "holding" only says a person is on it. */
export type DraftKind = "answer" | "holding";
export type DraftStatus = "pending" | "sent" | "edited" | "rejected" | "superseded";

export type AgentDraft = {
  id: string;
  ticket_id: string;
  kind: DraftKind;
  body: string;
  /** JSON array of article titles the draft drew on. */
  citations: string | null;
  rationale: string;
  based_on_message_id: string | null;
  status: DraftStatus;
  final_body: string | null;
  reject_reason: string | null;
  model: string;
  prompt_version: string;
  created_at: string;
  decided_at: string | null;
};

export type AgentRun = {
  id: string;
  ticket_id: string;
  trigger: string;
  outcome: string;
  detail: string | null;
  input_tokens: number;
  output_tokens: number;
  created_at: string;
};

export const AGENTS = ["You", "Sam"] as const;
