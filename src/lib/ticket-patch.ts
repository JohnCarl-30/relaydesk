import { listStaff } from "./db";
import type { Ticket } from "./models";

export const TICKET_STATUSES = ["open", "waiting", "closed"] as const;

export type TicketPatch = { status?: Ticket["status"]; assignee?: string | null };

/**
 * Checks a status/assignee change. The inbox's PATCH route and the MCP
 * update_ticket tool both use it, so they accept exactly the same changes.
 */
export function checkTicketPatch(
  businessId: string,
  input: { status?: unknown; assignee?: unknown },
): { patch: TicketPatch } | { error: string } {
  const patch: TicketPatch = {};
  if (input.status !== undefined) {
    if (!TICKET_STATUSES.includes(input.status as Ticket["status"])) {
      return { error: `bad status: use one of ${TICKET_STATUSES.join(", ")}` };
    }
    patch.status = input.status as Ticket["status"];
  }
  if (input.assignee !== undefined) {
    const names = listStaff(businessId).map((member) => member.name);
    if (input.assignee !== null && !names.includes(input.assignee as string)) {
      return { error: `bad assignee: use null or one of ${names.join(", ")}` };
    }
    patch.assignee = input.assignee as string | null;
  }
  return { patch };
}
