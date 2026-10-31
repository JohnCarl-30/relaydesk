export type Business = {
  /** URL-safe slug, e.g. "nimbus". Widget embeds and help-center links use it. */
  id: string;
  name: string;
  /** Bumped on every article change, so cached search indexes know to rebuild. */
  articles_version: number;
  /** 1 once the business went live; before that only its staff see anything. */
  live: number;
  created_at: string;
};

export type McpToken = {
  id: string;
  business_id: string;
  /** What the person called it, e.g. "Claude on Ana's laptop". */
  name: string;
  created_by: string;
  created_at: string;
  last_used_at: string | null;
};

export type Invite = {
  id: string;
  business_id: string;
  email: string;
  /** Staff id of who sent it. */
  invited_by: string;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
};

export type Staff = {
  id: string;
  business_id: string;
  email: string;
  name: string;
  created_at: string;
};

export type Conversation = {
  id: string;
  business_id: string;
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
  business_id: string;
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
  /** Sales signal the co-pilot read in the conversation; null before its first run. */
  intent: "lead" | "upgrade" | "churn_risk" | "none" | null;
  /** One line on why, shown next to the intent. */
  intent_reason: string | null;
  /** 1 when a co-pilot draft is waiting for review (listTickets only). */
  has_draft?: number;
};

/** What the inbox calls each intent. Lives here, not in intent.ts, so client components can import it without the tracing code. */
export const INTENT_LABEL: Record<NonNullable<Ticket["intent"]>, string> = {
  lead: "Sales lead",
  upgrade: "Upgrade",
  churn_risk: "Churn risk",
  none: "No sales signal",
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
