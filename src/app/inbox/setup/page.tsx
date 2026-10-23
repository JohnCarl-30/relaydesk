import Link from "next/link";
import { redirect } from "next/navigation";
import { CopyField, Section } from "@/components/admin";
import { currentStaff } from "@/lib/auth";
import { helpCenterPath } from "@/lib/business";
import { getBusiness, listArticles, listMcpTokens, listStaff } from "@/lib/db";
import { embedSnippet, publicOrigin } from "@/lib/origin";
import { GoLive } from "./go-live";
import { McpTokens } from "./mcp-tokens";
import { PreviewChat } from "./preview-chat";

export default async function SetupPage() {
  const staff = await currentStaff();
  if (!staff) redirect("/login");
  const business = getBusiness(staff.business_id);
  if (!business) redirect("/login");
  const articles = listArticles(business.id).length;
  const team = listStaff(business.id).length;
  const origin = await publicOrigin();
  const live = Boolean(business.live);

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-2xl font-medium tracking-tight">Set up {business.name}</h1>
      <p className="mt-1 text-sm text-muted">
        Add articles, try the chat, then go live and paste the widget into your site.
      </p>

      <ol className="mt-8 grid gap-3 sm:grid-cols-3">
        {[
          { done: articles > 0, text: articles > 0 ? `${articles} help ${articles === 1 ? "article" : "articles"}` : "Add help articles", href: "/inbox/articles" },
          { done: live, text: live ? "Live" : "Go live", href: "#go-live" },
          { done: team > 1, text: team > 1 ? `${team} people on the team` : "Invite your team", href: "/inbox/team" },
        ].map((step, i) => (
          <li key={step.text}>
            <Link href={step.href} className="flex items-center gap-3 rounded-xl border border-line bg-card px-4 py-3 text-sm transition hover:border-forest/40">
              <span
                className={
                  step.done
                    ? "flex h-6 w-6 items-center justify-center rounded-full bg-forest text-xs text-paper"
                    : "flex h-6 w-6 items-center justify-center rounded-full border border-line text-xs text-muted"
                }
                aria-hidden
              >
                {step.done ? "✓" : i + 1}
              </span>
              {step.text}
            </Link>
          </li>
        ))}
      </ol>

      <div className="mt-10">
        <Section
          title="Try the chat"
          description="Ask what your customers ask. It answers from your articles exactly like the widget will, but nothing is saved and no ticket is opened."
        >
          <PreviewChat businessName={business.name} disabled={articles === 0} />
        </Section>

        <Section
          title="Go live"
          description={
            live ? (
              <>
                Your help center is public at{" "}
                <Link href={helpCenterPath(business.id)} className="text-forest underline underline-offset-2">
                  {origin}
                  {helpCenterPath(business.id)}
                </Link>{" "}
                and the widget answers on any site with the snippet below.
              </>
            ) : (
              "Until you go live, your help center and widget show nothing to the public. Only your team can see this page."
            )
          }
        >
          <div id="go-live">
            <GoLive live={live} canGoLive={articles > 0} />
          </div>
        </Section>

        <Section
          title="Put the widget on your site"
          description="Paste this before </body> on every page that should have the chat. It works on any site builder that lets you add custom code."
        >
          <CopyField label="Embed snippet" value={embedSnippet(origin, business.id)} />
          <p className="mt-2 text-xs text-muted">
            Or link customers straight to your help center:{" "}
            <span className="font-mono">
              {origin}
              {helpCenterPath(business.id)}
            </span>
          </p>
        </Section>

        <Section
          title="Work the inbox from an AI assistant"
          description="Connect Claude, Cursor, or any MCP client. It can read tickets, search your articles, assign tickets, and save reply drafts. It can't message customers: drafts wait in this inbox for someone to send them."
        >
          <McpTokens tokens={listMcpTokens(business.id)} />
        </Section>
      </div>
    </main>
  );
}
