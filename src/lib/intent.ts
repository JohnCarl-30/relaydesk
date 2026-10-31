import type { ChatLike } from "./graph";
import { INTENT_LABEL, type Ticket } from "./models";
import { generationAttributes, withSpan } from "./trace";

/*
 * Revenue intent: the sales signal in a support conversation, read by the
 * co-pilot next to topic and summary. Nothing acts on it; staff see it in the
 * inbox. A keyword baseline runs without a model key, and a model classifier
 * runs with one and falls back to the keywords when its reply is unusable.
 */

export type Intent = NonNullable<Ticket["intent"]>;
export type IntentResult = { intent: Intent; reason: string };

export const INTENTS = ["lead", "upgrade", "churn_risk", "none"] as const satisfies readonly Intent[];

// Checked in this order: a customer who is leaving is a churn risk even when
// they also ask about plans, and a customer growing is an upgrade even when
// they ask for a price.
// "cancel" alone is a report or an invite as often as the account, so it needs
// the account, the subscription, or no object at all. "switch to annual" is an
// upgrade, so the switch rule skips plan and billing words.
const CHURN =
  /\b(?:cancel(?:l?ing|lation|led)?\b(?! (?:a|an|the|this|that|my|our) (?!(?:subscription|account|plan|renewal|contract|workspace)\b))|clos(?:e|ing) (?:my|our|the) account|delete (?:my|our) (?:account|workspace)|export everything|export all (?:my|our) data|(?:switch(?:ing)?|mov(?:e|ing)) (?:to|over to) (?!(?:annual|monthly|yearly|you|your|the pro|the business|the team|pro|business|enterprise|team)\b)\w+|leaving|unsubscribe|downgrad(?:e|ing)|not (?:going to )?renew(?:ing)?|too expensive|stop(?:ping)? (?:our|my|the) subscription)\b/i;
const UPGRADE =
  /\b(?:upgrad(?:e|ing)|more seats|(?:add|adding|need|needs|buy|buying) (?:\d+|more|a few|extra|another|additional)(?: \d+)? (?:more )?(?:seats?|users?|people|members|licen[cs]es?|teammates)|enterprise (?:plan|tier|pricing)|higher (?:plan|tier)|annual (?:plan|billing|contract)|(?:need|needs|want|wants|get|enable|turn on) sso|sso (?:and|for|on) (?:our|the)|business plan|team plan for our|(?:move|moving|go|going) (?:up )?to (?:the )?(?:pro|business|enterprise|team)\b|to the (?:pro|business|enterprise|team) plan)/i;
const LEAD =
  /\b(?:pricing|price list|free trial|trial|a demo|book a demo|quote|sign(?:ing)? up|get started|do you (?:have|offer|sell)|looking for a|considering|evaluating|shopping around|team plan|(?:plan|plans) for (?:a |our )?(?:\d+[- ]person |small |large )?(?:team|company|agency|startup)|how much (?:does|is|would|do) (?:it|nimbus|the \w+ plan|you|your)|is there a (?:plan|tier)|what plans)\b/i;

const RULES: [Intent, RegExp][] = [
  ["churn_risk", CHURN],
  ["upgrade", UPGRADE],
  ["lead", LEAD],
];

/** The keyword baseline, on what the customer wrote. Same rules with or without a model key. */
export function keywordIntent(visitorText: string): IntentResult {
  for (const [intent, pattern] of RULES) {
    const match = visitorText.match(pattern)?.[0];
    if (match) return { intent, reason: `Mentions "${match.trim()}".` };
  }
  return { intent: "none", reason: "No sales signal." };
}

const INTENT_SYSTEM = `You read a support conversation and name the sales signal in it, if any. Reply with JSON only: {"intent": "lead" | "upgrade" | "churn_risk" | "none", "reason": "<one short sentence quoting what the customer said>"}.
lead: not a customer yet, asking about plans, pricing, trials, or whether the product fits them.
upgrade: an existing customer who wants more seats, a higher plan, or a paid feature.
churn_risk: a customer talking about cancelling, leaving, exporting everything, downgrading, or switching to a competitor.
none: a support question with no sales signal.
When unsure, answer none: a false lead wastes a salesperson's time, a missed one is caught later.`;

export const INTENT_PROMPT_VERSION = "intent-a1";

/** Pulls {"intent", "reason"} out of a model reply; null when it is not a usable label. */
export function parseIntentReply(text: string): IntentResult | null {
  const json = text.match(/\{[\s\S]*\}/)?.[0];
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as { intent?: unknown; reason?: unknown };
    const intent = INTENTS.find((i) => i === parsed.intent);
    if (!intent) return null;
    const reason = typeof parsed.reason === "string" ? parsed.reason.replace(/\s+/g, " ").trim() : "";
    return { intent, reason: (reason || INTENT_LABEL[intent]).slice(0, 160) };
  } catch {
    return null;
  }
}

export type IntentInput = {
  /** Everything the customer wrote, which the keyword rules read. */
  visitorText: string;
  /** The whole conversation, "Customer:" / "Bot:" / "Staff:" lines, which the model reads. */
  transcript: string;
};

/**
 * Classifies with the model when one is given, else with the keywords. A model
 * error or an unusable reply falls back to the keywords, so every co-pilot run
 * ends with an intent.
 */
export async function classifyIntent(input: IntentInput, model: ChatLike | null): Promise<IntentResult> {
  const baseline = keywordIntent(input.visitorText);
  if (!model) return baseline;
  return withSpan("copilot.intent", { "intent.prompt_version": INTENT_PROMPT_VERSION }, async (span) => {
    const messages = [
      { role: "system", content: INTENT_SYSTEM },
      { role: "user", content: `Conversation:\n${input.transcript}` },
    ];
    try {
      const response = await model.invoke(messages);
      const text = typeof response.content === "string" ? response.content : JSON.stringify(response.content);
      span.setAttributes(
        generationAttributes({ model: "intent", input: messages, output: text, usage: response.usage_metadata }),
      );
      const parsed = parseIntentReply(text);
      span.setAttribute("intent.source", parsed ? "model" : "keywords");
      return parsed ?? baseline;
    } catch (err) {
      span.recordException(err as Error);
      span.setAttribute("intent.source", "keywords");
      return baseline;
    }
  });
}
