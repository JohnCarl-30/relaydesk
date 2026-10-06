import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { copilotEnabled } from "@/lib/copilot";
import { listTickets } from "@/lib/db";
import { InboxShell } from "./chrome";

export default async function InboxLayout({ children }: { children: React.ReactNode }) {
  if (!(await isAdmin())) redirect("/login");
  const tickets = listTickets();
  return (
    <InboxShell tickets={tickets} copilotOn={copilotEnabled()}>
      {children}
    </InboxShell>
  );
}
