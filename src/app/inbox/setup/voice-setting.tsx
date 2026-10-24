"use client";

import { ErrorLine, primaryButton, secondaryButton, useApi } from "@/components/admin";
import type { VoiceStatus } from "@/lib/server-voice";

function minutes(seconds: number): string {
  const m = Math.ceil(seconds / 60);
  return `${m} ${m === 1 ? "minute" : "minutes"}`;
}

export function VoiceSetting({ status }: { status: VoiceStatus }) {
  const { call, pending, error } = useApi();
  const outOfMinutes = status.enabled && status.usedSeconds >= status.capSeconds;
  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={
            status.provider === "elevenlabs"
              ? "rounded-full bg-forest/10 px-2.5 py-1 text-xs font-medium text-forest"
              : "rounded-full bg-line px-2.5 py-1 text-xs font-medium text-muted"
          }
        >
          {status.provider === "elevenlabs" ? "ElevenLabs" : "Browser voice"}
        </span>
        <button
          type="button"
          disabled={pending || (!status.enabled && !status.configured)}
          onClick={() => void call("/api/voice", "POST", { provider: status.enabled ? "browser" : "elevenlabs" })}
          className={status.enabled ? secondaryButton : primaryButton}
        >
          {status.enabled ? "Use the browser's voice" : "Use ElevenLabs"}
        </button>
      </div>
      {!status.configured ? (
        <p className="mt-2 text-xs text-muted">
          Needs <span className="font-mono">ELEVENLABS_API_KEY</span> on the server.
        </p>
      ) : status.enabled ? (
        <p className="mt-2 text-xs text-muted">
          {minutes(status.usedSeconds)} of {minutes(status.capSeconds)} used this month.
          {outOfMinutes ? " Out of minutes, so the widget is using the browser's voice until the 1st." : null}
        </p>
      ) : null}
      <ErrorLine error={error} />
    </div>
  );
}
