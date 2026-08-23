"use client";

import { useState } from "react";
import Link from "next/link";
import { useUser } from "@clerk/nextjs";
import { api } from "@/lib/trpc/client";
import { ACCOUNT_LINKS, ADMIN_LINKS, DIRECTORY_LINKS, NAV_LINKS } from "@/lib/nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { useCommandPalette } from "@/components/command-palette";
import { useInContext } from "@/components/context-switcher";
import { cn } from "@/lib/utils";

/**
 * Hamburger menu for < md screens — the desktop inline nav is hidden there,
 * so this is the only route to most of the app on phones.
 */
export function MobileNav() {
  const [open, setOpen] = useState(false);
  const { isSignedIn } = useUser();
  const palette = useCommandPalette();
  /*
   * Normally the desktop header carries the directory links and this button
   * hides above `lg`. Inside a team, a series or a race weekend the header
   * gives that space to the context switcher instead, and then this is the
   * only thing carrying the directory — so it stops hiding.
   */
  const inContext = useInContext();
  // Only fetched once the menu is open, and only for signed-in visitors —
  // a nav item is not worth a request on every page load.
  const access = api.access.mine.useQuery(undefined, {
    enabled: Boolean(isSignedIn) && open,
  });

  return (
    <div className={cn(!inContext && "lg:hidden")}>
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
        <nav
          /*
           * Scrollable, and measured in `dvh` rather than `vh`.
           *
           * There are twenty destinations in here plus the theme picker, which
           * is taller than a phone screen — without a height and an overflow
           * the bottom third was simply clipped, with no way to reach it.
           *
           * `dvh` is the part that is easy to get wrong: `vh` on mobile is the
           * viewport with the browser's chrome *hidden*, so a `100vh` panel
           * puts its last item behind the URL bar and the fix looks like it
           * did not work. `overscroll-contain` stops a flick at the end of the
           * list scrolling the page behind it instead.
           */
          className="absolute inset-x-0 top-16 z-50 max-h-[calc(100dvh-4rem)] overflow-y-auto overscroll-contain border-b border-brand-black/10 bg-surface shadow-lg"
        >
          <ul className="mx-auto max-w-6xl px-4 py-3">
            {/* First, because scrolling twenty destinations to find one is
                the thing this menu is worst at and typing its name is not. */}
            <li>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  palette.open();
                }}
                className="flex w-full items-center gap-2 rounded-md border border-brand-black/10 px-3 py-2.5 text-left text-sm text-brand-black/60 hover:bg-brand-black/5"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  aria-hidden="true"
                  className="h-4 w-4 shrink-0"
                >
                  <circle cx="10.6" cy="10.6" r="6.6" />
                  <path d="m20 20-4.7-4.7" />
                </svg>
                Search or jump to&hellip;
              </button>
            </li>
            <li
              aria-hidden
              className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-brand-black/40"
            >
              Browse
            </li>
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
            {/* Indented under Explore rather than dropped: Explore is how you
                browse now, but somebody who knows the tracks page exists
                should not have to discover that it moved. */}
            {DIRECTORY_LINKS.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className="block rounded-md py-2.5 pl-7 pr-3 text-sm font-medium text-brand-black/60 hover:bg-brand-black/5 hover:text-brand-red"
                >
                  {link.label}
                </Link>
              </li>
            ))}
            {isSignedIn && (
              <>
                <li
                  aria-hidden
                  className="my-2 border-t border-brand-black/10"
                />
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
                <li
                  aria-hidden
                  className="my-2 border-t border-brand-black/10"
                />
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
            <li aria-hidden className="my-2 border-t border-brand-black/10" />
            <li>
              <ThemeToggle className="pb-2" />
            </li>
          </ul>
        </nav>
      )}
    </div>
  );
}
