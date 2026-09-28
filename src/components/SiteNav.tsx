"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/help", label: "Help" },
  { href: "/inbox", label: "Inbox" },
];

export function SiteNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="hidden items-center gap-8 text-sm sm:flex">
      {LINKS.map(({ href, label }) => {
        const current = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={current ? "page" : undefined}
            className={
              current
                ? "text-ink underline decoration-copper decoration-2 underline-offset-[6px]"
                : "text-muted transition-colors hover:text-ink"
            }
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
