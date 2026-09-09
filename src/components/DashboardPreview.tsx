export function DashboardPreview() {
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-card shadow-[0_28px_80px_-28px_rgba(27,61,49,0.4)]">
      <div className="flex items-center gap-1.5 border-b border-line px-4 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-[#e8c4b8]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#e6d9a8]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#c5d4c8]" />
        <p className="ml-3 truncate text-xs text-muted">nimbus.app / Board · last 14 days</p>
      </div>
      <div className="grid min-h-[22rem] sm:grid-cols-[10.5rem_1fr]">
        <aside className="hidden border-r border-line bg-[#f6f1e8] px-2.5 py-4 text-[13px] sm:block">
          <p className="px-2 text-[10px] font-medium uppercase tracking-widest text-muted">
            Workspace
          </p>
          <ul className="mt-2 space-y-0.5">
            {[
              ["Board", true],
              ["Insights", false],
              ["Funnels", false],
              ["Retention", false],
              ["Flows", false],
            ].map(([label, active]) => (
              <li
                key={String(label)}
                className={
                  active
                    ? "rounded-md bg-forest px-2 py-1.5 text-paper"
                    : "rounded-md px-2 py-1.5 text-muted"
                }
              >
                {label}
              </li>
            ))}
          </ul>
        </aside>
        <div className="grid gap-3 p-4 sm:grid-cols-3">
          <article className="rounded-lg border border-line bg-paper p-4 sm:col-span-2">
            <p className="text-xs text-muted">Daily active users</p>
            <p className="mt-1 font-serif text-3xl tracking-tight">12,840</p>
            <p className="mt-1 text-xs text-forest-2">↑ 8.4% vs prior period</p>
            <svg viewBox="0 0 320 88" className="mt-4 h-20 w-full" aria-hidden>
              <polyline
                fill="none"
                stroke="#1b3d31"
                strokeWidth="2"
                points="0,70 40,62 80,66 120,44 160,48 200,28 240,34 280,18 320,22"
              />
              <polyline
                fill="none"
                stroke="#b4532a"
                strokeWidth="2"
                strokeOpacity="0.7"
                points="0,78 40,74 80,72 120,60 160,58 200,50 240,46 280,40 320,38"
              />
            </svg>
          </article>
          <article className="rounded-lg border border-line bg-paper p-4">
            <p className="text-xs text-muted">New users</p>
            <p className="mt-1 font-serif text-3xl tracking-tight">4,390</p>
            <p className="mt-1 text-xs text-forest-2">↑ 12%</p>
            <div className="mt-6 space-y-2">
              {[
                ["Organic", "w-4/5"],
                ["Ads", "w-2/3"],
                ["Invite", "w-1/2"],
              ].map(([name, width]) => (
                <div key={name}>
                  <p className="text-[11px] text-muted">{name}</p>
                  <div className="mt-1 h-1.5 rounded-full bg-line">
                    <div className={`h-1.5 rounded-full bg-forest ${width}`} />
                  </div>
                </div>
              ))}
            </div>
          </article>
          <article className="rounded-lg border border-line bg-paper p-4 sm:col-span-3">
            <p className="text-xs text-muted">Signup → first chart</p>
            <div className="mt-3 flex items-end gap-3">
              {[
                ["Visited", "h-16", "82%"],
                ["Signed up", "h-12", "41%"],
                ["Ingested", "h-9", "28%"],
                ["Chart", "h-6", "19%"],
              ].map(([label, height, pct]) => (
                <div key={label} className="flex-1">
                  <div className={`rounded-md bg-forest/80 ${height}`} />
                  <p className="mt-2 text-[11px] text-muted">{label}</p>
                  <p className="text-xs font-medium">{pct}</p>
                </div>
              ))}
            </div>
          </article>
        </div>
      </div>
    </div>
  );
}
