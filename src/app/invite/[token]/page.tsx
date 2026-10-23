import Link from "next/link";
import { AuthCard } from "@/components/AuthCard";
import { findInvite, getBusiness } from "@/lib/db";
import { AcceptInviteForm } from "./accept-form";

export const metadata = { title: "Join your team · Relaydesk" };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = findInvite(token);
  const business = invite && getBusiness(invite.business_id);
  if (!invite || !business) {
    return (
      <AuthCard title="This invite doesn't work" intro="It was already used, it expired, or the link got cut off. Ask for a new one.">
        <Link href="/login" className="mt-6 inline-block text-sm text-forest underline underline-offset-2">
          Sign in instead
        </Link>
      </AuthCard>
    );
  }
  return (
    <AuthCard
      title={`Join ${business.name}`}
      intro={
        <>
          You&apos;re invited as <span className="text-ink">{invite.email}</span>. Pick a name your
          team will see and a password.
        </>
      }
    >
      <AcceptInviteForm token={token} />
    </AuthCard>
  );
}
