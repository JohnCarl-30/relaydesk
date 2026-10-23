import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Widget } from "@/components/Widget";
import { helpCenterPath, loadHelpCenter } from "@/lib/business";

type Params = { params: Promise<{ business: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const center = loadHelpCenter((await params).business);
  if (!center) return {};
  const title = `${center.name} help center`;
  return { title, description: `Answers from ${center.name}.`, openGraph: { title, siteName: center.name } };
}

/** A business's public help center: its articles plus its chat widget. */
export default async function HostedHelpLayout({
  children,
  params,
}: Params & { children: React.ReactNode }) {
  const center = loadHelpCenter((await params).business);
  if (!center) notFound();
  const base = helpCenterPath(center.businessId);
  return (
    <div className="min-h-full bg-paper text-ink">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-forest px-3 py-2 text-sm text-paper focus:not-sr-only focus:fixed focus:left-4 focus:top-3"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-30 border-b border-line/80 bg-paper/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <Link href={base} className="inline-flex items-center gap-2 text-sm font-medium tracking-tight">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-forest" />
            {center.name}
          </Link>
          <p className="text-xs text-muted">Help center</p>
        </div>
      </header>
      <div id="main" tabIndex={-1} className="outline-none">
        {children}
      </div>
      <Widget business={{ id: center.businessId, name: center.name }} helpBase={base} />
    </div>
  );
}
