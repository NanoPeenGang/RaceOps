"use client";

import Link from "next/link";
import { api } from "@/lib/trpc/client";

export function NotificationBell() {
  const unread = api.notification.unreadCount.useQuery(undefined, {
    refetchInterval: 60_000,
    retry: false,
  });
  const count = unread.data ?? 0;

  return (
    <Link
      href="/notifications"
      className="relative text-sm font-medium text-brand-black/70 hover:text-brand-red"
      aria-label={`Notifications${count ? ` (${count} unread)` : ""}`}
    >
      🔔
      {count > 0 && (
        <span className="absolute -right-2 -top-1 rounded-full bg-brand-red px-1.5 text-[10px] font-bold text-white">
          {count > 9 ? "9+" : count}
        </span>
      )}
    </Link>
  );
}
