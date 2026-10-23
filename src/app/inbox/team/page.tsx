import { redirect } from "next/navigation";
import { Section } from "@/components/admin";
import { currentStaff } from "@/lib/auth";
import { listPendingInvites, listStaff } from "@/lib/db";
import { InviteForm, PendingInvites, StaffList } from "./team-forms";

export default async function TeamPage() {
  const staff = await currentStaff();
  if (!staff) redirect("/login");
  const members = listStaff(staff.business_id);
  const invites = listPendingInvites(staff.business_id);

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-2xl font-medium tracking-tight">Team</h1>
      <p className="mt-1 text-sm text-muted">Everyone here can answer tickets, edit articles, and invite others.</p>
      <div className="mt-8">
        <Section title="People">
          <StaffList members={members} meId={staff.id} />
        </Section>
        <Section
          title="Invite someone"
          description="You get a link to send them yourself, by chat or email. It works once and expires in 7 days."
        >
          <InviteForm />
        </Section>
        {invites.length > 0 ? (
          <Section title="Waiting to join">
            <PendingInvites invites={invites} />
          </Section>
        ) : null}
      </div>
    </main>
  );
}
