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
import type { McpToken } from "@/lib/models";

export function McpTokens({ tokens }: { tokens: McpToken[] }) {
  const [name, setName] = useState("");
  const [created, setCreated] = useState<{ token: string; url: string } | null>(null);
  const { call, pending, error } = useApi();

  async function create(event: React.FormEvent) {
    event.preventDefault();
    const result = await call<{ token: string; url: string }>("/api/mcp-tokens", "POST", { name });
    if (result) {
      setCreated(result);
      setName("");
    }
  }

  return (
    <div>
      <form onSubmit={create} className="flex gap-2">
        <input
          required
          aria-label="Token name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Claude on my laptop"
          className={inputClass}
        />
        <button type="submit" disabled={pending} className={`${primaryButton} shrink-0`}>
          Create token
        </button>
      </form>
      <ErrorLine error={error} />
      {created ? (
        <div className="mt-4 space-y-2 rounded-xl bg-forest/5 p-4">
          <p className="text-sm">Copy it now; it&apos;s shown only once. For Claude Code, run:</p>
          <CopyField
            label="Claude Code command"
            value={`claude mcp add --transport http relaydesk ${created.url} --header "Authorization: Bearer ${created.token}"`}
          />
          <p className="text-xs text-muted">Other clients: URL {created.url}, header Authorization: Bearer &lt;token&gt;.</p>
          <CopyField label="MCP token" value={created.token} />
        </div>
      ) : null}
      {tokens.length > 0 ? (
        <ul className="mt-4 divide-y divide-line overflow-hidden rounded-xl border border-line bg-card">
          {tokens.map((token) => (
            <li key={token.id} className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
              <div>
                <p>{token.name}</p>
                <p className="text-xs text-muted">
                  {token.last_used_at
                    ? `Last used ${new Date(token.last_used_at).toLocaleString()}`
                    : "Not used yet"}
                </p>
              </div>
              <button
                type="button"
                disabled={pending}
                aria-label={`Revoke ${token.name}`}
                className={secondaryButton}
                onClick={() => void call(`/api/mcp-tokens/${token.id}`, "DELETE")}
              >
                Revoke
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
