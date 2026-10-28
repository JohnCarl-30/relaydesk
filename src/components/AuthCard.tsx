import Link from "next/link";
import { Brand } from "@/components/Brand";

/** The frame around sign-up and invite forms. */
export function AuthCard({ title, intro, children }: { title: string; intro: React.ReactNode; children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col bg-card px-6 py-8">
      <Link href="/" className="inline-flex items-center gap-2 text-sm font-medium tracking-tight">
        <Brand />
      </Link>
      <div className="m-auto w-full max-w-sm py-12">
        <h1 className="text-2xl font-medium tracking-tight">{title}</h1>
        <p className="mt-2 text-sm text-muted">{intro}</p>
        {children}
      </div>
    </main>
  );
}

export function Field({
  label,
  hint,
  ...input
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  return (
    <label className="mt-4 block text-sm">
      <span className="text-muted">{label}</span>
      <input
        {...input}
        className="mt-1.5 w-full rounded-lg border border-line bg-paper px-3 py-2.5 text-sm outline-none ring-forest/20 focus:ring-2"
      />
      {hint ? <span className="mt-1 block text-xs text-muted">{hint}</span> : null}
    </label>
  );
}
