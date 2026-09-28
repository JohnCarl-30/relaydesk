"use client";

import { openChat } from "@/components/Widget";

export function OpenChatButton({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button type="button" onClick={openChat} className={className}>
      {children}
    </button>
  );
}
