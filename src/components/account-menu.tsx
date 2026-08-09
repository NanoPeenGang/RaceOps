"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { api } from "@/lib/trpc/client";
import { ACCOUNT_LINKS, ADMIN_LINKS } from "@/lib/nav";

/**
 * The account destinations, on desktop.
 *
 * They were unreachable above 1024px. `ACCOUNT_LINKS` was rendered only by the
 * mobile menu, which is `lg:hidden`, and the desktop header hardcoded three of
 * the ten — so Messages, My organizations, My passes, My postings, Apply and
 * the sponsor console had no path to them at all on a laptop. The nav test did
 * not catch it because it checks the shared definitions, not which breakpoint
 * renders them.
 *
 * A menu rather than more links in the bar: ten destinations across the header
 * is how a header becomes unreadable, and these are all "mine" rather than
 * places to browse, which is exactly what a menu behind a name is for.
 */
export function AccountMenu() {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  // Only asked once the menu is opened: a staff-only link is not worth a
  // request on every page load for everybody who is not staff.
  const access = api.access.mine.useQuery(undefined, { enabled: open });

  // A menu that survives navigation is a menu covering the page you asked for.
  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const links = [
    ...ACCOUNT_LINKS,
    ...(access.data?.isStaff ? ADMIN_LINKS : []),
  ];

  return (
    <div ref={containerRef} className="relative hidden lg:block">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="rounded-md px-2 py-1 text-sm font-medium text-brand-black/70 transition-colors hover:text-brand-red"
      >
        My RaceOps <span aria-hidden>{open ? "\u2303" : "\u2304"}</span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-56 rounded-lg border border-brand-black/10 bg-brand-offwhite py-1 shadow-lg"
        >
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              role="menuitem"
              className="block px-3 py-2 text-sm text-brand-black/80 hover:bg-brand-black/5 hover:text-brand-red"
            >
              {link.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
