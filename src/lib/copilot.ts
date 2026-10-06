import { getArticle, type Article } from "./articles";
import { isAcknowledgement, type ConversationTurn } from "./conversation-context";
import {
  countRunsSince,
  getSetting,
  getTicket,
  insertDraft,
  listMessages,
  recordRun,
  setTicketTriage,
  type AgentDraft,
  type Message,
  type Ticket,
} from "./db";
import { isVisitorEscalation, PENDING_TICKET_EMAIL, REFUSE_LINE } from "./escalate";
import { answerQuestion, chatModel, hasLlm, usingStubLlm } from "./graph";
import { withSpan } from "./trace";

/*
 * The inbox co-pilot. It reads a ticket, files it under a topic, and saves one
 * pending reply draft for staff to send, edit, or reject. It never sends: this
 * module can write drafts, triage fields, and run logs, and nothing else.
 */

export const COPILOT_PROMPT_VERSION = "copilot-a1";
export const COPILOT_SETTING = "copilot";
export const MAX_RUNS_PER_DAY = 5;

export type CopilotTrigger = "ticket_created" | "regenerate";
export type CopilotOutcome = "answer" | "holding" | "disabled" | "rate_limited" | "error";

/** Why the ticket exists, which decides what kind of draft is safe. */
export type EscalationReason =
  | "policy"
  | "not_in_help_center"
  | "answer_didnt_help"
  | "asked_for_person";

const POLICY_TERMS =
  /\b(refunds?|chargebacks?|discounts?|credits?|cancel(?:lation|led|ling|ing)?|lawyers?|legal|lawsuit|sue)\b/i;
const DIDNT_HELP = /didn'?t help|did not help/i;

const REASON_TEXT: Record<EscalationReason, string> = {
  policy: "Needs a person's decision.",
  not_in_help_center: "The help center has no answer for this.",
  answer_didnt_help: "The customer said the bot's answer didn't help.",
  asked_for_person: "The customer pushed back or asked for a person.",
};

// Each line follows "Hi <name>, " and carries its own thanks.
const HOLDING_LINE: Record<EscalationReason, string> = {
  policy:
    "thanks for reaching out. A person on our team needs to review this, so I've passed it along.",
  not_in_help_center:
    "thanks for your question. Our help center doesn't cover this yet, so I've passed it to the team.",
  answer_didnt_help:
    "thanks for letting us know the article didn't answer it. I've passed this to the team so a person can look at your case.",
  asked_for_person:
    "thanks for your patience. I've passed this to the team so a person can look at your case.",
};

const DRAFT_SYSTEM =
  "You draft replies for Nimbus support staff, who review every draft before it is sent. Write to the customer by first name. Use only the help articles and the conversation provided. Answer the customer's actual question; if the articles do not fully answer it, say a teammate will follow up. Never promise refunds, discounts, credits, dates, or features. Plain text, under 120 words, no sign-off.";

export type TicketContext = {
  /** The customer's question the ticket is about. */
  question: string;
  /** Conversation before that question, for follow-up resolution. */
  history: ConversationTurn[];
  reason: EscalationReason;
  policyTerm: string | null;
  /** First name, or "there" when the customer left no email. */
  name: string;
  lastMessageId: string | null;
  transcript: string;
};

function firstName(email: string): string {
  if (!email.includes("@") || email === PENDING_TICKET_EMAIL) return "there";
  const local = email.split("@")[0].split(/[._+-]/)[0];
  return local ? local[0].toUpperCase() + local.slice(1) : "there";
}

function speaker(role: Message["role"]): string {
  return role === "visitor" ? "Customer" : role === "agent" ? "Staff" : "Bot";
}

/**
 * The question is the last real customer message the bot answered; later
 * messages ("This didn't help", "I need a human") are the reason for the
 * ticket, not the question.
 */
export function readTicket(ticket: Ticket, messages: Message[]): TicketContext {
  const isQuestion = (m: Message) =>
    m.role === "visitor" && !isVisitorEscalation(m.body) && !isAcknowledgement(m.body);
  const answered = messages.findLastIndex(
    (m, i) => isQuestion(m) && messages.slice(i + 1).some((later) => later.role !== "visitor"),
  );
  const index = answered >= 0 ? answered : messages.findLastIndex(isQuestion);
  const question = index >= 0 ? messages[index].body.trim() : ticket.preview;
  const reply = index >= 0 ? messages.slice(index + 1).find((m) => m.role !== "visitor") : undefined;
  const after = index >= 0 ? messages.slice(index + 1) : messages;

  const policyTerm =
    messages
      .filter((m) => m.role === "visitor")
      .map((m) => m.body.match(POLICY_TERMS)?.[0])
      .find(Boolean) ?? null;
  const reason: EscalationReason = policyTerm
    ? "policy"
    : reply?.body.startsWith(REFUSE_LINE)
      ? "not_in_help_center"
      : after.some((m) => m.role === "visitor" && DIDNT_HELP.test(m.body))
        ? "answer_didnt_help"
        : "asked_for_person";

  return {
    question,
    history: (index >= 0 ? messages.slice(0, index) : []).map(({ role, body }) => ({ role, body })),
    reason,
    policyTerm,
    name: firstName(ticket.email),
    lastMessageId: messages.at(-1)?.id ?? null,
    transcript: messages.map((m) => `${speaker(m.role)}: ${m.body}`).join("\n"),
  };
}

function oneLine(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 120 ? `${flat.slice(0, 117)}…` : flat;
}

type Drafted = {
  kind: AgentDraft["kind"];
  body: string;
  rationale: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
};

function holdingDraft(context: TicketContext, sources: Article[]): Drafted {
  const closest = sources[0] ? ` Closest article: "${sources[0].title}".` : "";
  const why =
    context.reason === "policy" && context.policyTerm
      ? `Mentions "${context.policyTerm}". ${REASON_TEXT.policy}`
      : REASON_TEXT[context.reason];
  return {
    kind: "holding",
    body: `Hi ${context.name}, ${HOLDING_LINE[context.reason]} We'll reply here as soon as we can.`,
    rationale: `${why}${closest}`,
    model: "template",
    inputTokens: 0,
    outputTokens: 0,
  };
}

async function modelDraft(context: TicketContext, sources: Article[]): Promise<Drafted | null> {
  const articles = sources.map((a, i) => `[${i + 1}] ${a.title}\n${a.body}`).join("\n\n");
  const response = await chatModel().invoke([
    { role: "system", content: DRAFT_SYSTEM },
    {
      role: "user",
      content: `Customer first name: ${context.name}\n\nConversation:\n${context.transcript}\n\nHelp articles:\n${articles}`,
    },
  ]);
  const body = typeof response.content === "string" ? response.content.trim() : "";
  // A draft that talks money or cancellation goes back to a holding reply.
  if (!body || POLICY_TERMS.test(body)) return null;
  return {
    kind: "answer",
    body,
    rationale: `Drafted from ${sources.map((a) => `"${a.title}"`).join(", ")}.`,
    model: usingStubLlm() ? "stub" : (process.env.OPENAI_MODEL ?? "gpt-4o-mini"),
    inputTokens: response.usage_metadata?.input_tokens ?? 0,
    outputTokens: response.usage_metadata?.output_tokens ?? 0,
  };
}

export function copilotEnabled(): boolean {
  return getSetting(COPILOT_SETTING) !== "off";
}

export async function runCopilot(
  ticketId: string,
  trigger: CopilotTrigger,
): Promise<{ outcome: CopilotOutcome; draft?: AgentDraft }> {
  return withSpan("copilot.run", { "copilot.trigger": trigger, "copilot.ticket": ticketId }, async (span) => {
    const log = (outcome: CopilotOutcome, detail: string | null, tokens?: Drafted) => {
      recordRun({
        ticket_id: ticketId,
        trigger,
        outcome,
        detail,
        input_tokens: tokens?.inputTokens ?? 0,
        output_tokens: tokens?.outputTokens ?? 0,
      });
      span.setAttribute("copilot.outcome", outcome);
    };

    const ticket = getTicket(ticketId);
    if (!ticket) return { outcome: "error" };
    if (!copilotEnabled()) {
      log("disabled", "Co-pilot is off.");
      return { outcome: "disabled" };
    }
    const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
    if (countRunsSince(ticket.id, dayAgo) >= MAX_RUNS_PER_DAY) {
      log("rate_limited", `${MAX_RUNS_PER_DAY} runs in the last 24 hours.`);
      return { outcome: "rate_limited" };
    }

    try {
      const context = readTicket(ticket, listMessages(ticket.conversation_id));
      const result = await answerQuestion(context.question, {
        history: context.history,
        rewrite: false,
      });
      const sources = result.citations
        .map((c) => getArticle(c.slug))
        .filter((a): a is Article => Boolean(a));
      const canAnswer =
        hasLlm() &&
        sources.length > 0 &&
        context.reason !== "policy" &&
        context.reason !== "not_in_help_center";
      const drafted =
        (canAnswer ? await modelDraft(context, sources).catch(() => null) : null) ??
        holdingDraft(context, sources);

      const draft = insertDraft({
        ticket_id: ticket.id,
        kind: drafted.kind,
        body: drafted.body,
        citations: sources.length ? JSON.stringify(sources.map((a) => a.title)) : null,
        rationale: drafted.rationale,
        based_on_message_id: context.lastMessageId,
        model: drafted.model,
        prompt_version: COPILOT_PROMPT_VERSION,
      });
      setTicketTriage(ticket.id, {
        topic: sources[0]?.category ?? "Other",
        summary: oneLine(context.question),
        needsHumanReason: drafted.kind === "holding" ? drafted.rationale : null,
      });
      span.setAttribute("copilot.reason", context.reason);
      log(drafted.kind, drafted.rationale, drafted);
      return { outcome: drafted.kind, draft };
    } catch (err) {
      log("error", err instanceof Error ? err.message : String(err));
      return { outcome: "error" };
    }
  });
}
