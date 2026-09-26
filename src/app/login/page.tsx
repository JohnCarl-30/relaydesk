"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { DashboardPreview } from "@/components/DashboardPreview";
import { Logo } from "@/components/ui";

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (!res.ok) {
      setError("Wrong password. Demo default is nimbus-demo.");
      return;
    }
    router.push("/inbox");
    router.refresh();
  }

  return (
    <main className="grid min-h-full lg:grid-cols-2">
      <section className="flex flex-col bg-card px-6 py-8">
        <Link href="/" className="text-sm">
          <Logo />
        </Link>
        <form onSubmit={onSubmit} className="m-auto w-full max-w-sm py-16">
          <h1 className="text-2xl font-medium tracking-tight">Staff inbox</h1>
          <p className="mt-2 text-sm text-muted">
            Staff inbox. Demo password is{" "}
            <code className="text-ink">nimbus-demo</code>.
          </p>
          <label className="mt-8 block text-sm">
            <span className="text-muted">Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-line bg-paper px-3 py-2.5 text-sm outline-none ring-forest/20 focus:ring-2"
              autoFocus
            />
          </label>
          {error ? <p className="mt-2 text-sm text-copper">{error}</p> : null}
          <button
            type="submit"
            className="mt-5 w-full rounded-lg bg-forest py-2.5 text-sm text-paper hover:bg-forest-2"
          >
            Sign in
          </button>
          <Link href="/" className="mt-6 block text-center text-sm text-muted hover:text-ink">
            Back to Nimbus
          </Link>
        </form>
        <p className="text-xs text-muted">Nimbus · Relaydesk demo</p>
      </section>
      <section className="relative hidden overflow-hidden bg-[linear-gradient(165deg,#1b3d31_0%,#2d5a48_45%,#e4ece6_100%)] p-10 lg:flex lg:flex-col lg:justify-end">
        <p className="max-w-md font-serif text-3xl leading-snug text-paper">
          &ldquo;Seat count on the invoice is a snapshot. If someone left on day 28
          they still appear.&rdquo;
        </p>
        <p className="mt-4 text-sm text-paper/70">
          From How billing works: seats and the invoice
        </p>
        <div className="mt-10 origin-bottom-left scale-[0.92]">
          <DashboardPreview />
        </div>
      </section>
    </main>
  );
}
