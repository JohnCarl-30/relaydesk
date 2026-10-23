"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Field } from "@/components/AuthCard";
import { slugify } from "@/lib/article-import";

export function SignUpForm({ needsCode }: { needsCode: boolean }) {
  const router = useRouter();
  const [businessName, setBusinessName] = useState("");
  const [businessId, setBusinessId] = useState("");
  const [idEdited, setIdEdited] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const link = idEdited ? businessId : slugify(businessName).slice(0, 40).replace(/-+$/, "");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const res = await fetch("/api/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ businessName, businessId: link, name, email, password, code }),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    setPending(false);
    if (!res.ok) {
      setError(data.error ?? "Sign-up failed.");
      return;
    }
    router.push("/inbox/setup");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="mt-4">
      <Field label="Business name" required value={businessName} onChange={(e) => setBusinessName(e.target.value)} autoFocus />
      <Field
        label="Link"
        required
        value={link}
        onChange={(e) => {
          setIdEdited(true);
          setBusinessId(e.target.value.toLowerCase());
        }}
        hint={link ? `Your help center: /h/${link}` : "Lowercase letters, digits, and dashes."}
      />
      <Field label="Your name" required value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
      <Field label="Email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
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
      {needsCode ? (
        <Field label="Sign-up code" required value={code} onChange={(e) => setCode(e.target.value)} hint="Relaydesk is invite-only for now." />
      ) : null}
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
        Create my help center
      </button>
    </form>
  );
}
