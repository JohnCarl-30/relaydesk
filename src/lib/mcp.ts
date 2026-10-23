import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { loadHelpCenter } from "./business";
import { runCopilot } from "./copilot";
import {
  getPendingDraft,
  getTicket,
  insertDraft,
  listMessages,
  listRuns,
  listTickets,
  updateTicket,
} from "./db";
import { articleBySlug, type HelpCenter } from "./help-center";
import { retrieve } from "./rag";
import { checkTicketPatch, TICKET_STATUSES } from "./ticket-patch";
import { withSpan } from "./trace";

/*
 * Relaydesk's inbox as MCP tools, for staff working tickets from Claude,
 * Cursor, or any MCP client. One server per request, bound to the business
 * the bearer token belongs to.
 *
 * The co-pilot's rule holds here too: an agent can read, triage, and draft,
 * but nothing reaches the customer until a person presses Send in /inbox.
 * There is deliberately no tool that posts a message.
 */

export const MCP_DRAFT_MODEL = "mcp";
export const MCP_PROMPT_VERSION = "mcp-v1";

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

const ok = (value: unknown): ToolResult => ({
  content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
});
const fail = (message: string): ToolResult => ({
  content: [{ type: "text", text: message }],
  isError: true,
});

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;
// Writes, but only to the inbox: never to the customer.
const INBOX_WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;

export function buildMcpServer(businessId: string): McpServer {
  const server = new McpServer(
    { name: "relaydesk", version: "1.0.0" },
    {
      instructions:
        "Relaydesk support inbox for one business. Read tickets, search the help center, triage, and save reply drafts. Drafts are reviewed and sent by staff in the Relaydesk inbox; you cannot message customers directly. Cite help-center articles by slug when drafting.",
    },
  );

  /** Every tool call is a span, so MCP use sits next to chat and co-pilot runs in Langfuse. */
  function traced<A>(name: string, fn: (args: A, center: HelpCenter) => ToolResult | Promise<ToolResult>) {
    return (args: A) =>
      withSpan(`mcp.${name}`, { "business.id": businessId, "mcp.tool": name }, async (span) => {
        const center = loadHelpCenter(businessId);
        if (!center) return fail("This business no longer exists.");
        const result = await fn(args, center);
        span.setAttribute("mcp.is_error", Boolean(result.isError));
        return result;
      });
  }

  const notFound = (id: string) => fail(`No ticket ${id} in this inbox.`);

  server.registerTool(
    "list_tickets",
    {
      title: "List tickets",
      description:
        "Tickets in this business's inbox, newest activity first. Each has id, status, assignee, topic, a one-line summary, why a person is needed, whether a draft is waiting, and when it last changed.",
      inputSchema: {
        status: z.enum(TICKET_STATUSES).optional().describe("Only tickets with this status."),
        assignee: z.string().nullable().optional().describe("Only tickets given to this staff name; null for unassigned."),
        has_draft: z.boolean().optional().describe("Only tickets with (true) or without (false) a pending draft."),
        limit: z.number().int().min(1).max(100).default(25),
      },
      annotations: { title: "List tickets", ...READ_ONLY },
    },
    traced("list_tickets", ({ status, assignee, has_draft, limit }) => {
      const tickets = listTickets(businessId)
        .filter((t) => status === undefined || t.status === status)
        .filter((t) => assignee === undefined || t.assignee === assignee)
        .filter((t) => has_draft === undefined || Boolean(t.has_draft) === has_draft)
        .slice(0, limit)
        .map((t) => ({
          id: t.id,
          status: t.status,
          assignee: t.assignee,
          topic: t.topic,
          summary: t.summary ?? t.preview,
          needs_human_reason: t.needs_human_reason,
          has_draft: Boolean(t.has_draft),
          updated_at: t.updated_at,
        }));
      return ok({ tickets });
    }),
  );

  server.registerTool(
    "get_ticket",
    {
      title: "Get a ticket",
      description:
        "One ticket with its whole conversation (customer, bot, and staff messages), the pending reply draft if any, and the co-pilot's last runs.",
      inputSchema: { ticket_id: z.string().describe("e.g. tkt_1a2b3c4d") },
      annotations: { title: "Get a ticket", ...READ_ONLY },
    },
    traced("get_ticket", ({ ticket_id }) => {
      const ticket = getTicket(businessId, ticket_id);
      if (!ticket) return notFound(ticket_id);
      const draft = getPendingDraft(ticket.id);
      return ok({
        ticket: {
          id: ticket.id,
          status: ticket.status,
          assignee: ticket.assignee,
          email: ticket.email,
          topic: ticket.topic,
          summary: ticket.summary,
          needs_human_reason: ticket.needs_human_reason,
          created_at: ticket.created_at,
          updated_at: ticket.updated_at,
        },
        messages: listMessages(ticket.conversation_id).map((m) => ({
          role: m.role === "visitor" ? "customer" : m.role === "agent" ? "staff" : "bot",
          body: m.body,
          cited: m.citations ? (JSON.parse(m.citations) as string[]) : [],
          at: m.created_at,
        })),
        pending_draft: draft
          ? {
              id: draft.id,
              kind: draft.kind,
              body: draft.body,
              rationale: draft.rationale,
              cited: draft.citations ? (JSON.parse(draft.citations) as string[]) : [],
              model: draft.model,
            }
          : null,
        copilot_runs: listRuns(ticket.id, 5).map((r) => ({
          trigger: r.trigger,
          outcome: r.outcome,
          detail: r.detail,
          at: r.created_at,
        })),
      });
    }),
  );

  server.registerTool(
    "search_help_center",
    {
      title: "Search the help center",
      description:
        "Searches this business's help articles the way the chat widget does. Returns slug, title, score, and the matching text. Use slugs as citations in draft_reply.",
      inputSchema: {
        query: z.string().min(1),
        limit: z.number().int().min(1).max(10).default(3),
      },
      annotations: { title: "Search the help center", ...READ_ONLY },
    },
    traced("search_help_center", ({ query, limit }, center) =>
      ok({
        results: retrieve(query, { corpus: center.corpus, k: limit }).map((hit) => ({
          slug: hit.article.slug,
          title: hit.article.title,
          score: hit.score,
          text: hit.text,
        })),
      }),
    ),
  );

  server.registerTool(
    "get_article",
    {
      title: "Get an article",
      description: "The full help article for a slug.",
      inputSchema: { slug: z.string() },
      annotations: { title: "Get an article", ...READ_ONLY },
    },
    traced("get_article", ({ slug }, center) => {
      const article = articleBySlug(center, slug);
      return article ? ok({ article }) : fail(`No article "${slug}". Try search_help_center.`);
    }),
  );

  server.registerTool(
    "update_ticket",
    {
      title: "Update a ticket",
      description:
        "Sets a ticket's status (open, waiting, closed) and/or who it's given to (a staff name, or null to unassign). Doesn't message the customer.",
      inputSchema: {
        ticket_id: z.string(),
        status: z.string().optional(),
        assignee: z.string().nullable().optional(),
      },
      annotations: { title: "Update a ticket", ...INBOX_WRITE, idempotentHint: true },
    },
    traced("update_ticket", ({ ticket_id, status, assignee }) => {
      if (status === undefined && assignee === undefined) {
        return fail("Pass status, assignee, or both.");
      }
      const checked = checkTicketPatch(businessId, { status, assignee });
      if ("error" in checked) return fail(checked.error);
      const ticket = updateTicket(businessId, ticket_id, checked.patch);
      if (!ticket) return notFound(ticket_id);
      return ok({ ticket: { id: ticket.id, status: ticket.status, assignee: ticket.assignee } });
    }),
  );

  server.registerTool(
    "draft_reply",
    {
      title: "Draft a reply",
      description:
        "Saves a reply draft on the ticket for staff to review. It replaces any earlier pending draft and is NOT sent: a person sends, edits, or rejects it in the Relaydesk inbox. Cite the help articles it relies on by slug.",
      inputSchema: {
        ticket_id: z.string(),
        body: z.string().min(1).max(4_000).describe("The reply to the customer, plain text."),
        rationale: z.string().min(1).max(500).describe("One line for staff: why this reply."),
        citations: z.array(z.string()).max(5).default([]).describe("Slugs of the articles the reply relies on."),
      },
      annotations: { title: "Draft a reply", ...INBOX_WRITE, idempotentHint: false },
    },
    traced("draft_reply", ({ ticket_id, body, rationale, citations }, center) => {
      const ticket = getTicket(businessId, ticket_id);
      if (!ticket) return notFound(ticket_id);
      const articles = citations.map((slug) => ({ slug, article: articleBySlug(center, slug) }));
      const missing = articles.filter((a) => !a.article).map((a) => a.slug);
      if (missing.length) return fail(`Unknown article slugs: ${missing.join(", ")}.`);
      const titles = articles.map((a) => a.article!.title);
      const draft = insertDraft({
        ticket_id: ticket.id,
        kind: titles.length ? "answer" : "holding",
        body: body.trim(),
        citations: titles.length ? JSON.stringify(titles) : null,
        rationale: rationale.trim(),
        based_on_message_id: listMessages(ticket.conversation_id).at(-1)?.id ?? null,
        model: MCP_DRAFT_MODEL,
        prompt_version: MCP_PROMPT_VERSION,
      });
      return ok({
        draft: { id: draft.id, ticket_id: ticket.id, status: draft.status },
        note: "Saved for review. Staff send it from the inbox.",
      });
    }),
  );

  server.registerTool(
    "regenerate_draft",
    {
      title: "Regenerate the co-pilot draft",
      description:
        "Runs Relaydesk's own co-pilot on the ticket, like the inbox's Regenerate button: same 5-runs-a-day limit and on/off switch. Returns the outcome and the new draft.",
      inputSchema: { ticket_id: z.string() },
      annotations: { title: "Regenerate the co-pilot draft", ...INBOX_WRITE, idempotentHint: false },
    },
    traced("regenerate_draft", async ({ ticket_id }) => {
      if (!getTicket(businessId, ticket_id)) return notFound(ticket_id);
      const { outcome, draft } = await runCopilot(businessId, ticket_id, "regenerate");
      if (outcome === "disabled") return fail("The co-pilot is switched off for this inbox.");
      if (outcome === "rate_limited") return fail("This ticket hit the co-pilot's daily run limit.");
      if (outcome === "error" || !draft) return fail("The co-pilot couldn't draft this ticket.");
      return ok({
        outcome,
        draft: { id: draft.id, kind: draft.kind, body: draft.body, rationale: draft.rationale },
      });
    }),
  );

  return server;
}
