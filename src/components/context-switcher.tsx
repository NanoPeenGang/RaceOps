"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { api } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import { NAV_LINKS } from "@/lib/nav";
import {
  activeContext,
  CONTEXT_KIND_LABELS,
  groupContexts,
  resolveRoute,
  switchTo,
  type ContextOption,
} from "@/lib/app-context";
import { useCommandPalette } from "@/components/command-palette";
import type { PaletteContexts } from "@/lib/command-set";

/**
 * The header's left-hand chrome: either the directory, or what you are in.
 *
 * There is only room for one of them. The header has about thirty pixels of
 * slack at every width once the logo, the nine directory links, the search box
 * and the account cluster have taken their share, and a switcher needs closer
 * to two hundred — measured, not guessed.
 *
 * So the two take turns, which is also the argument the redesign makes: while
 * you are browsing, the directory is the navigation; the moment you are inside
 * something, that thing is. Nothing becomes unreachable when the links step
 * aside — the menu button appears in their place and carries all of them, and
 * ⌘K finds any of them by name.
 */
export function HeaderContext() {
  return (
    <Suspense fallback={<DirectoryLinks />}>
      <HeaderContextInner />
    </Suspense>
  );
}

function DirectoryLinks() {
  return (
    <nav className="hidden items-center gap-5 lg:flex">
      {NAV_LINKS.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className="text-sm font-medium text-brand-black/70 transition-colors hover:text-brand-red"
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}

function HeaderContextInner() {
  const { isSignedIn } = useUser();
  const options = useContextOptions(Boolean(isSignedIn));
  const route = usePathRoute();
  const active = activeContext(route, options);

  if (!active) return <DirectoryLinks />;
  return <Switcher active={active} options={options} />;
}

/**
 * Whether the header is currently showing a switcher rather than the links.
 *
 * The mobile menu asks, because it is the only thing carrying the directory
 * once the links have stepped aside — so it has to stop hiding itself on
 * desktop exactly when that happens.
 */
export function useInContext(): boolean {
  const { isSignedIn } = useUser();
  const options = useContextOptions(Boolean(isSignedIn));
  const route = usePathRoute();
  return activeContext(route, options) !== null;
}

/**
 * The context from the path alone.
 *
 * Free of `useSearchParams`, and that is not an accident: reading the search
 * params opts every page that renders the component out of prerendering
 * unless a Suspense boundary sits above it, and this hook is called from the
 * mobile menu, which has no such boundary. Picking *which* context you are in
 * never needed the query string anyway.
 */
function usePathRoute() {
  const pathname = usePathname();
  return useMemo(() => resolveRoute(pathname ?? "/"), [pathname]);
}

/**
 * The same, plus the tab you are on.
 *
 * Only the switcher menu needs this — to land you on the same tab of whatever
 * you switch to — and it is rendered inside the boundary `HeaderContext` puts
 * up, which is what makes reading the search params safe here.
 */
function useTabRoute() {
  const pathname = usePathname();
  const tab = useSearchParams().get("tab");
  return useMemo(() => resolveRoute(pathname ?? "/", tab), [pathname, tab]);
}

/**
 * Your contexts, from the query the command palette already makes.
 *
 * Deliberately the same procedure and the same cache key: the palette and the
 * switcher want exactly the same list, and asking twice would double the cost
 * of every page load to show the same names in two places.
 */
function useContextOptions(enabled: boolean): ContextOption[] {
  const query = api.command.contexts.useQuery(undefined, {
    enabled,
    meta: { silenceError: true },
    staleTime: 60_000,
  });
  return useMemo(() => toOptions(query.data), [query.data]);
}

export function toOptions(contexts: PaletteContexts | undefined): ContextOption[] {
  if (!contexts) return [];
  return [
    ...contexts.teams.map((team) => ({
      kind: "team" as const,
      key: team.slug,
      name: team.name,
      detail: team.role,
      canManage: team.canManage,
    })),
    ...contexts.series.map((series) => ({
      kind: "series" as const,
      key: series.slug,
      name: series.name,
      detail: series.role,
      canManage: series.canManage,
    })),
    ...contexts.organizations.map((organization) => ({
      kind: "organization" as const,
      key: organization.slug,
      name: organization.name,
      detail: organization.role,
      canManage: false,
    })),
    ...contexts.events.map((event) => ({
      kind: "event" as const,
      key: event.id,
      name: event.name,
      detail: event.live
        ? "Running now"
        : [event.seriesName, event.when].filter(Boolean).join(" · "),
      canManage: event.canManage,
      live: event.live,
    })),
  ];
}

function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[words.length - 1]![0]!).toUpperCase();
}

function Switcher({ active, options }: { active: ContextOption; options: ContextOption[] }) {
  const [open, setOpen] = useState(false);
  const route = useTabRoute();
  const pathname = usePathname();
  const palette = useCommandPalette();
  const containerRef = useRef<HTMLDivElement>(null);

  // A switch is a navigation, and the menu must not survive it.
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

  const groups = useMemo(() => groupContexts(options), [options]);

  return (
    <div ref={containerRef} className="relative min-w-0">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "flex h-10 min-w-0 items-center gap-2.5 rounded-lg border border-brand-black/10 bg-surface py-1 pl-1.5 pr-2.5 text-left transition-colors hover:border-brand-black/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red",
          open && "border-brand-red",
        )}
      >
        <Avatar name={active.name} live={active.live} />
        <span className="min-w-0">
          <span className="block text-[9px] font-bold uppercase tracking-[0.09em] text-brand-black/60">
            {CONTEXT_KIND_LABELS[active.kind]}
          </span>
          {/* Widths measured against the real header: once the directory
              links step aside there is room to spell a long name out on a
              desktop, and none at all on a phone. */}
          <span className="block max-w-[9rem] truncate text-[13px] font-semibold text-brand-black sm:max-w-[13rem] lg:max-w-[20rem]">
            {active.name}
          </span>
        </span>
        <Chevron className="h-4 w-4 shrink-0 text-brand-black/50" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 top-[calc(100%+6px)] z-50 max-h-[min(70dvh,32rem)] w-[22rem] overflow-y-auto overscroll-contain rounded-xl border border-brand-black/10 bg-surface shadow-lg"
        >
          <div className="p-1.5">
            <SwitchLink
              href="/home"
              name="You"
              detail="Your seats, messages, passes and applications"
              active={false}
            />
            {groups.map((group) => (
              <div key={group.label}>
                <div className="px-3 pb-1 pt-3 text-[9.5px] font-bold uppercase tracking-[0.1em] text-brand-black/50">
                  {group.label}
                </div>
                {group.options.map((option) => (
                  <SwitchLink
                    key={`${option.kind}:${option.key}`}
                    href={switchTo(route, option)}
                    name={option.name}
                    detail={option.detail}
                    live={option.live}
                    active={option.kind === active.kind && option.key === active.key}
                  />
                ))}
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2 border-t border-brand-black/10 bg-brand-black/5 px-3 py-2">
            <span className="flex-1 text-xs text-brand-black/60">
              Looking for something you are not part of?
            </span>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                palette.open();
              }}
              className="shrink-0 text-xs font-semibold text-brand-red hover:underline"
            >
              Search
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SwitchLink({
  href,
  name,
  detail,
  live,
  active,
}: {
  href: string;
  name: string;
  detail: string;
  live?: boolean;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      role="menuitem"
      aria-current={active ? "true" : undefined}
      className={cn(
        "flex items-center gap-3 rounded-lg px-2.5 py-2 hover:bg-brand-black/5",
        active && "bg-brand-black/5",
      )}
    >
      <Avatar name={name} live={live} size={30} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold text-brand-black">{name}</span>
        <span className="block truncate text-[11.5px] text-brand-black/60">{detail}</span>
      </span>
      {active && <Check className="h-4 w-4 shrink-0 text-brand-red" />}
    </Link>
  );
}

function Avatar({ name, live, size = 26 }: { name: string; live?: boolean; size?: number }) {
  return (
    <span
      className={cn(
        "relative flex shrink-0 items-center justify-center rounded-md font-bold",
        live ? "bg-brand-red text-on-red" : "bg-brand-black/10 text-brand-black",
      )}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}
      aria-hidden="true"
    >
      {initialsOf(name)}
      {live && (
        <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-brand-red ring-2 ring-surface" />
      )}
    </span>
  );
}

function Chevron({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d="m6.5 9.75 5.5 5.5 5.5-5.5" />
    </svg>
  );
}

function Check({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d="m5 12.4 4.6 4.6L19 7.2" />
    </svg>
  );
}
