import Link from "next/link";
import { Widget } from "@/components/Widget";
import { Logo } from "@/components/ui";

export default function NimbusLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-full bg-paper text-ink">
      <header className="sticky top-0 z-30 border-b border-line/80 bg-paper/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <Link href="/" className="text-sm">
            <Logo />
          </Link>
          <nav className="hidden items-center gap-8 text-sm text-muted sm:flex">
            <Link href="/help" className="hover:text-ink">
              Help
            </Link>
            <Link href="/inbox" className="hover:text-ink">
              Inbox
            </Link>
          </nav>
          <div className="flex items-center gap-3 text-sm">
            <Link href="/inbox" className="px-2 py-1.5 text-muted hover:text-ink">
              Log in
            </Link>
            <Link
              href="/help"
              className="rounded-lg bg-forest px-3.5 py-1.5 text-paper hover:bg-forest-2"
            >
              Get started
            </Link>
          </div>
        </div>
      </header>
      {children}
      <Widget />
    </div>
  );
}
