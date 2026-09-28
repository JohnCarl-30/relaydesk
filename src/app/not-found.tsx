import Link from "next/link";
import { Logo } from "@/components/ui";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col bg-paper px-6 py-8 text-ink">
      <Link href="/" className="text-sm">
        <Logo />
      </Link>
      <div className="my-auto max-w-md py-16">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-copper">404</p>
        <h1 className="mt-3 font-serif text-4xl tracking-tight">That page isn&apos;t here.</h1>
        <p className="mt-3 text-muted">
          The link may be old, or the article or ticket was removed.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-5 text-sm">
          <Link
            href="/help"
            className="rounded-lg bg-forest px-4 py-2.5 text-paper transition hover:bg-forest-2 active:scale-[0.98]"
          >
            Browse the help center
          </Link>
          <Link href="/" className="text-muted underline-offset-4 hover:text-ink hover:underline">
            Back to Nimbus
          </Link>
        </div>
      </div>
    </main>
  );
}
