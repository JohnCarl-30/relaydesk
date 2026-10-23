import { redirect } from "next/navigation";
import { currentStaff } from "@/lib/auth";
import { helpCenterPath } from "@/lib/business";
import { copilotEnabled } from "@/lib/copilot";
import { getBusiness, listTickets } from "@/lib/db";
import { InboxShell } from "./chrome";

export default async function InboxLayout({ children }: { children: React.ReactNode }) {
  const staff = await currentStaff();
  if (!staff) redirect("/login");
  const business = getBusiness(staff.business_id);
  if (!business) redirect("/login");
  return (
    <InboxShell
      business={{ name: business.name, helpHref: helpCenterPath(business.id) }}
      tickets={listTickets(business.id)}
      copilotOn={copilotEnabled(business.id)}
    >
      {children}
    </InboxShell>
  );
}
