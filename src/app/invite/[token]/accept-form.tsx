"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Field } from "@/components/AuthCard";

export function AcceptInviteForm({ token }: { token: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const res = await fetch("/api/invites/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, name, password }),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    setPending(false);
    if (!res.ok) {
      setError(data.error ?? "Couldn't join.");
      return;
    }
    router.push("/inbox");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="mt-4">
      <Field label="Your name" required value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" autoFocus />
      <Field
        label="Password"
        type="password"
        required
        minLength={10}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete="new-password"
        hint="At least 10 characters."
      />
      {error ? (
        <p role="alert" className="mt-3 text-sm text-copper">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="mt-6 w-full rounded-lg bg-forest py-2.5 text-sm text-paper transition hover:bg-forest-2 active:scale-[0.98] disabled:opacity-50"
      >
        Join the inbox
      </button>
    </form>
  );
}
