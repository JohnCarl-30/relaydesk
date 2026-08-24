"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

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
    <main className="flex min-h-full items-center justify-center bg-[#121613] px-6 text-[#e8eee9]">
      <form onSubmit={onSubmit} className="w-full max-w-sm">
        <p className="text-xs uppercase tracking-widest text-[#8aa396]">Relaydesk</p>
        <h1 className="mt-2 font-serif text-3xl">Staff inbox</h1>
        <p className="mt-2 text-sm text-[#8aa396]">
          Demo password <code className="text-[#e8eee9]">nimbus-demo</code>
        </p>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-6 w-full rounded-lg border border-[#2c342f] bg-[#1a1f1c] px-3 py-2 text-sm outline-none"
          autoFocus
        />
        {error ? <p className="mt-2 text-sm text-[#e07a4c]">{error}</p> : null}
        <button
          type="submit"
          className="mt-4 w-full rounded-lg bg-[#cfe0d4] py-2 text-sm text-[#121613]"
        >
          Enter
        </button>
        <a href="/" className="mt-6 block text-center text-xs text-[#8aa396]">
          ← Back to Nimbus
        </a>
      </form>
    </main>
  );
}
