import Link from "next/link";
import { Widget } from "@/components/Widget";

export default function NimbusLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-full bg-paper text-ink">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-2 text-sm font-medium tracking-tight">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-forest" />
            Nimbus
          </Link>
          <nav className="flex items-center gap-6 text-sm text-muted">
            <Link href="/help" className="hover:text-ink">
              Help center
            </Link>
            <Link href="/inbox" className="hover:text-ink">
              Staff inbox
            </Link>
          </nav>
        </div>
      </header>
      {children}
      <Widget />
    </div>
  );
}
