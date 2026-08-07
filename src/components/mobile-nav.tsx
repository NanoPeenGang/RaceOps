"use client";

import { useState } from "react";
import Link from "next/link";
import { useUser } from "@clerk/nextjs";
import { api } from "@/lib/trpc/client";
import { ACCOUNT_LINKS, ADMIN_LINKS, NAV_LINKS } from "@/lib/nav";

/**
 * Hamburger menu for < md screens — the desktop inline nav is hidden there,
 * so this is the only route to most of the app on phones.
 */
export function MobileNav() {
  const [open, setOpen] = useState(false);
  const { isSignedIn } = useUser();
  // Only fetched once the menu is open, and only for signed-in visitors —
  // a nav item is not worth a request on every page load.
  const access = api.access.mine.useQuery(undefined, {
    enabled: Boolean(isSignedIn) && open,
  });

  return (
    <div className="lg:hidden">
      <button
        type="button"
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-10 w-10 items-center justify-center rounded-md text-2xl leading-none text-brand-black/80 hover:bg-brand-black/5"
      >
        {open ? "✕" : "☰"}
      </button>

      {open && (
        <nav className="absolute inset-x-0 top-16 z-50 border-b border-brand-black/10 bg-brand-offwhite shadow-lg">
          <ul className="mx-auto max-w-6xl px-4 py-3">
            {NAV_LINKS.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className="block rounded-md px-3 py-3 text-base font-medium text-brand-black/80 hover:bg-brand-black/5 hover:text-brand-red"
                >
                  {link.label}
                </Link>
              </li>
            ))}
            {isSignedIn && (
              <>
                <li aria-hidden className="my-2 border-t border-brand-black/10" />
                {ACCOUNT_LINKS.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      onClick={() => setOpen(false)}
                      className="block rounded-md px-3 py-3 text-base font-medium text-brand-black/80 hover:bg-brand-black/5 hover:text-brand-red"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </>
            )}
            {access.data?.isStaff && (
              <>
                <li aria-hidden className="my-2 border-t border-brand-black/10" />
                {ADMIN_LINKS.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      onClick={() => setOpen(false)}
                      className="block rounded-md px-3 py-3 text-base font-medium text-brand-black/80 hover:bg-brand-black/5 hover:text-brand-red"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </>
            )}
          </ul>
        </nav>
      )}
    </div>
  );
}
