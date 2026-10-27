/** Relaydesk's conversation and handoff mark, paired with its wordmark. */
export function Brand() {
  return (
    <span className="inline-flex items-center gap-2 font-medium tracking-tight text-forest">
      <svg aria-hidden="true" viewBox="0 0 32 32" className="h-7 w-7 shrink-0" fill="none">
        <path d="M5 6h15a5 5 0 0 1 5 5v5a5 5 0 0 1-5 5h-6l-5 4v-4H8a3 3 0 0 1-3-3V6Z" fill="#1b3d31" />
        <path d="M10 12h10M10 16h6" stroke="#f3eee4" strokeWidth="2" strokeLinecap="round" />
        <path d="M19 24h8m-3-3 3 3-3 3" stroke="#b4532a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      Relaydesk
    </span>
  );
}
