"use client";

import { useState } from "react";
import {
  CopyField,
  ErrorLine,
  inputClass,
  primaryButton,
  secondaryButton,
  useApi,
} from "@/components/admin";
import type { Invite, Staff } from "@/lib/models";

export function StaffList({ members, meId }: { members: Staff[]; meId: string }) {
  const { call, pending, error } = useApi();
  return (
    <>
      <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-card">
        {members.map((member) => (
          <li key={member.id} className="flex items-center justify-between gap-4 px-4 py-3">
            <div className="min-w-0">
              <p className="font-medium">
                {member.name}
                {member.id === meId ? <span className="ml-2 text-xs font-normal text-muted">you</span> : null}
              </p>
              <p className="truncate text-sm text-muted">{member.email}</p>
            </div>
            {member.id === meId ? null : (
              <button
                type="button"
                disabled={pending}
                aria-label={`Remove ${member.name}`}
                className={secondaryButton}
                onClick={() => void call(`/api/staff/${member.id}`, "DELETE")}
              >
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>
      <ErrorLine error={error} />
    </>
  );
}

export function InviteForm() {
  const [email, setEmail] = useState("");
  const [link, setLink] = useState<{ email: string; url: string } | null>(null);
  const { call, pending, error } = useApi();

  async function invite(event: React.FormEvent) {
    event.preventDefault();
    const result = await call<{ link: string }>("/api/invites", "POST", { email });
    if (result) {
      setLink({ email, url: result.link });
      setEmail("");
    }
  }

  return (
    <div>
      <form onSubmit={invite} className="flex gap-2">
        <input
          type="email"
          required
          aria-label="Email to invite"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="teammate@example.com"
          className={inputClass}
        />
        <button type="submit" disabled={pending} className={`${primaryButton} shrink-0`}>
          Create invite
        </button>
      </form>
      <ErrorLine error={error} />
      {link ? (
        <div className="mt-4 rounded-xl bg-forest/5 p-4">
          <p className="mb-2 text-sm">
            Send this link to <span className="font-medium">{link.email}</span>. It&apos;s shown only now.
          </p>
          <CopyField label="Invite link" value={link.url} />
        </div>
      ) : null}
    </div>
  );
}

export function PendingInvites({ invites }: { invites: Invite[] }) {
  const { call, pending, error } = useApi();
  return (
    <>
      <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-card">
        {invites.map((invite) => (
          <li key={invite.id} className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
            <div>
              <p>{invite.email}</p>
              <p className="text-xs text-muted">Expires {new Date(invite.expires_at).toLocaleDateString()}</p>
            </div>
            <button
              type="button"
              disabled={pending}
              aria-label={`Cancel invite for ${invite.email}`}
              className={secondaryButton}
              onClick={() => void call(`/api/invites/${invite.id}`, "DELETE")}
            >
              Cancel
            </button>
          </li>
        ))}
      </ul>
      <ErrorLine error={error} />
    </>
  );
}
