import Link from "next/link";
import { SiteNav } from "@/components/SiteNav";
import { Widget } from "@/components/Widget";
import { Logo } from "@/components/ui";

export default function NimbusLayout({ children }: { children: React.ReactNode }) {
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
          <Link href="/" className="text-sm">
            <Logo />
          </Link>
          <SiteNav />
          <div className="flex items-center gap-3 text-sm">
            <Link href="/inbox" className="px-2 py-1.5 text-muted transition-colors hover:text-ink">
              Log in
            </Link>
            <Link
              href="/help"
              className="rounded-lg bg-forest px-3.5 py-1.5 text-paper transition hover:bg-forest-2 active:scale-[0.98]"
            >
              Get started
            </Link>
          </div>
        </div>
      </header>
      <div id="main" tabIndex={-1} className="outline-none">
        {children}
      </div>
      <Widget />
    </div>
  );
}
