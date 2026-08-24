export type Article = {
  slug: string;
  title: string;
  category: string;
  summary: string;
  body: string;
};

export const ARTICLES: Article[] = [
  {
    slug: "workspaces",
    title: "What is a Nimbus workspace?",
    category: "Getting started",
    summary: "A workspace is the billing and data boundary for your team.",
    body: `A Nimbus workspace holds your projects, teammates, and bill. Event data never crosses workspaces.

Create one workspace per company. Agencies that run analytics for several clients should create one workspace per client so invoices and retention settings stay separate.

The owner can rename a workspace from Settings → General. Changing the name does not change the workspace ID used in the API.`,
  },
  {
    slug: "billing-seats-events",
    title: "How billing works: seats and events",
    category: "Billing",
    summary: "You pay for seats plus a monthly event quota.",
    body: `Nimbus bills two dimensions.

Seats: every person with login access counts, including viewers. Pending invites do not count until they accept.

Events: tracked product events that land in Nimbus. Internal \`nimbus.*\` system events are free and do not count toward quota.

Plans: Starter (3 seats, 1M events), Growth (10 seats, 10M events), Scale (unlimited seats, custom events). If you exceed events mid-cycle we do not drop data. We invoice the overage on the next statement at $0.00012 per extra event.

Seat count on the invoice is a snapshot from the last day of the billing period. If someone left on day 28 they still appear on that invoice.`,
  },
  {
    slug: "failed-payment",
    title: "What happens if a payment fails?",
    category: "Billing",
    summary: "We retry for 14 days, then freeze writes.",
    body: `If a card is declined we retry on day 3, 7, and 14. You will get email each time.

During retries, dashboards stay readable. New event writes pause only after day 14. Existing data is not deleted.

Update the card under Settings → Billing. As soon as a payment succeeds, writes resume within a few minutes. We do not charge a reactivation fee.`,
  },
  {
    slug: "sso",
    title: "Set up Google or Okta SSO",
    category: "Security",
    summary: "SSO is available on Growth and Scale. One provider per workspace.",
    body: `Go to Settings → Security → SSO. Pick Google Workspace or Okta.

Google: enter your company domain. Users must sign in with that domain. Personal Gmail accounts are rejected.

Okta: create a SAML app with ACS URL and Entity ID shown on that page. Map email to NameID.

After SSO is on, password login is disabled for that workspace. If SSO loops (you bounce back to Google or Okta), check that the ACS URL has no trailing slash and that the user exists as a Nimbus member first. JIT provisioning is off by default; turn it on only if you want first-time SSO users created as viewers.`,
  },
  {
    slug: "api-keys",
    title: "API keys and rate limits",
    category: "Developers",
    summary: "Project keys ingest events. Workspace keys read data.",
    body: `There are two key types.

Project write key: used by the JS snippet and server SDKs to send events. It can only write. Rotate it from Project → API.

Workspace read key: used for the query API and CSV exports. It cannot ingest events. Treat it like a password.

Rate limits: 100 requests / second per write key, 10 / second per read key. Burst above that returns HTTP 429 with Retry-After. Keys created before March 2025 share a workspace-wide 50 rps cap; create a new key to get the current limits.

Never ship a read key in frontend code.`,
  },
  {
    slug: "data-retention",
    title: "Data retention windows",
    category: "Privacy",
    summary: "Starter keeps 30 days. Growth 90. Scale 365 or custom.",
    body: `Raw events older than the retention window are deleted on a nightly job around 03:00 UTC. Saved funnel and chart definitions are kept; only the underlying events go away.

Changing a plan does not rewrite history. If you downgrade from Growth to Starter, events older than 30 days are deleted on the next nightly job. Export first.

To export before a downgrade: any chart → Export CSV, or the query API with a read key. CSV exports are capped at 500,000 rows per file.`,
  },
  {
    slug: "inviting-teammates",
    title: "Invite teammates and assign roles",
    category: "Team",
    summary: "Owners, editors, and viewers. Invites expire in 7 days.",
    body: `Settings → Team → Invite. Enter email and a role.

Owner: billing, SSO, delete workspace.
Editor: create charts, funnels, and keys. Cannot change billing.
Viewer: read dashboards only.

An invite expires after 7 days. Expired invites do not occupy a seat. Resend from the same page.

You cannot demote the last owner. Transfer ownership first.`,
  },
  {
    slug: "funnel-zeros",
    title: "A funnel shows zeros or a sudden drop",
    category: "Charts",
    summary: "Usually a renamed event, a filter, or timezone, not lost data.",
    body: `If a funnel that used to work now shows zero:

1. Open each step and confirm the event name still matches what the SDK sends. Renaming an event in code does not rename historical events.
2. Check filters on the funnel (browser, plan, country). A filter on \`plan = pro\` hides free users.
3. Timezone: Nimbus stores UTC. The chart timezone is a display setting. A “today” funnel at 01:00 in Manila is still “yesterday” in UTC.

Data is not sampled on Growth or Scale. Starter samples at 1% after 200k events in a day, which can make a funnel look empty for rare steps. Upgrade or look at a longer range.`,
  },
  {
    slug: "csv-export",
    title: "Export a chart or events to CSV",
    category: "Charts",
    summary: "Exports are capped at 500k rows and email a link when large.",
    body: `On any chart click Export CSV. Files under 50 MB download in the browser. Larger jobs email a signed link to the requester that expires in 24 hours.

The Events explorer can export raw rows with the same cap. Use a workspace read key and the query API if you need a recurring dump.

Exports include the event name, timestamp (UTC), and properties. They do not include other users’ private dashboard names.`,
  },
  {
    slug: "delete-project",
    title: "Delete a project",
    category: "Getting started",
    summary: "Deletion is permanent after 7 days in the recycle bin.",
    body: `Project settings → Danger → Move to recycle bin. The project disappears from the sidebar immediately. Events stop ingesting.

For 7 days an owner can restore it from Settings → Recycle bin. After that, events and charts are deleted and the project ID is never reused.

Deleting a project does not change seat count. It can reduce events on the next invoice if that project was a large share of volume.`,
  },
];

export function getArticle(slug: string): Article | undefined {
  return ARTICLES.find((article) => article.slug === slug);
}
