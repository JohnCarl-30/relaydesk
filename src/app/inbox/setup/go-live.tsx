"use client";

import { ErrorLine, primaryButton, secondaryButton, useApi } from "@/components/admin";

export function GoLive({ live, canGoLive }: { live: boolean; canGoLive: boolean }) {
  const { call, pending, error } = useApi();
  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={
            live
              ? "rounded-full bg-forest/10 px-2.5 py-1 text-xs font-medium text-forest"
              : "rounded-full bg-line px-2.5 py-1 text-xs font-medium text-muted"
          }
        >
          {live ? "Live" : "Not live"}
        </span>
        <button
          type="button"
          disabled={pending || (!live && !canGoLive)}
          onClick={() => void call("/api/business", "PATCH", { live: !live })}
          className={live ? secondaryButton : primaryButton}
        >
          {live ? "Hide from the public" : "Go live"}
        </button>
        {!live && !canGoLive ? <span className="text-xs text-muted">Add an article first.</span> : null}
      </div>
      <ErrorLine error={error} />
    </div>
  );
}
