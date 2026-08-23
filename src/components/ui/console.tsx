"use client";

import { Suspense } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { TabStrip, useTabSelection, type TabDefinition } from "@/components/ui/tabs";

/**
 * A management console: the same tabs, as a rail.
 *
 * The consoles nest three deep and carry five to eight tabs each, and a strip
 * of eight scrolls on anything narrower than a laptop — which is how a tab
 * ends up shipped and then reported as missing. Down the side they are all
 * visible at once, and the room a strip does not have is room for the pages
 * that live *beside* a console rather than inside it.
 *
 * Those siblings are the reason this exists at all. The gate screen is a real
 * route with no link from the event console; the scan station only appears
 * inside the garage tab. A rail has somewhere to put them.
 *
 * Below the breakpoint it falls back to the strip. A sidebar on a phone takes
 * a third of the screen before any content appears, which is a worse answer
 * than scrolling.
 */

export interface ConsolePage {
  href: string;
  label: string;
  /** A count or a dot, same as a tab's. */
  badge?: React.ReactNode;
}

export interface ConsoleProps {
  tabs: TabDefinition[];
  /** Routes beside the console — reachable, at last, by looking. */
  pages?: ConsolePage[];
  /** Heading over those routes. Say what they are, not that they are "more". */
  pagesLabel?: string;
  param?: string;
  className?: string;
}

export function Console(props: ConsoleProps) {
  return (
    <Suspense
      fallback={<div className={cn("h-10 border-b border-brand-black/10", props.className)} />}
    >
      <ConsoleInner {...props} />
    </Suspense>
  );
}

function ConsoleInner({
  tabs,
  pages = [],
  pagesLabel = "Also here",
  param = "tab",
  className,
}: ConsoleProps) {
  const { visible, current, active, select } = useTabSelection(tabs, param);

  return (
    <div className={cn("lg:flex lg:gap-8", className)}>
      <nav
        aria-label="Console"
        /*
         * Sticky under the 64px header, so the rail stays put while a long
         * panel scrolls. Its own overflow is set because a console with
         * every tab and half a dozen sibling pages can outgrow a laptop.
         */
        className="hidden w-56 shrink-0 lg:block"
      >
        <div className="sticky top-20 max-h-[calc(100dvh-6rem)] overflow-y-auto overscroll-contain py-1">
          <ul role="tablist" aria-orientation="vertical" className="space-y-0.5">
            {visible.map((tab) => {
              const isActive = tab.id === active;
              return (
                <li key={tab.id}>
                  <button
                    type="button"
                    role="tab"
                    id={`rail-${tab.id}`}
                    aria-selected={isActive}
                    aria-controls={`panel-${tab.id}`}
                    onClick={() => select(tab.id)}
                    className={cn(
                      "relative flex w-full items-center gap-2 rounded-md py-2 pl-3 pr-2.5 text-left text-sm transition-colors",
                      isActive
                        ? "bg-brand-black/5 font-semibold text-brand-black"
                        : "font-medium text-brand-black/70 hover:bg-brand-black/5 hover:text-brand-black",
                    )}
                  >
                    {/* The vertical reading of the strip's red underline. */}
                    {isActive && (
                      <span
                        aria-hidden="true"
                        className="absolute inset-y-1.5 left-0 w-[3px] rounded-r bg-brand-red"
                      />
                    )}
                    <span className="min-w-0 flex-1 truncate">{tab.label}</span>
                    {tab.badge !== undefined && tab.badge !== null && (
                      <span className="shrink-0 rounded-full bg-brand-black/10 px-1.5 py-0.5 text-xs tabular-nums">
                        {tab.badge}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>

          {pages.length > 0 && (
            <>
              <h2 className="border-t border-brand-black/10 px-3 pb-1 pt-4 text-[10px] font-bold uppercase tracking-[0.1em] text-brand-black/50">
                {pagesLabel}
              </h2>
              <ul className="space-y-0.5">
                {pages.map((page) => (
                  <li key={page.href}>
                    <Link
                      href={page.href}
                      className="flex items-center gap-2 rounded-md py-2 pl-3 pr-2.5 text-sm font-medium text-brand-black/70 transition-colors hover:bg-brand-black/5 hover:text-brand-black"
                    >
                      <span className="min-w-0 flex-1 truncate">{page.label}</span>
                      {page.badge !== undefined && page.badge !== null && (
                        <span className="shrink-0 rounded-full bg-brand-black/10 px-1.5 py-0.5 text-xs tabular-nums">
                          {page.badge}
                        </span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </nav>

      <div className="min-w-0 flex-1">
        <div className="lg:hidden">
          <TabStrip visible={visible} active={active} select={select} />
        </div>

        {current && (
          <div
            role="tabpanel"
            id={`panel-${current.id}`}
            aria-labelledby={`rail-${current.id}`}
            className="pt-6 lg:pt-0"
          >
            {current.content}
          </div>
        )}

        {/*
          The sibling pages again, for the phone. The rail is where they live
          on a desktop, and dropping them below the breakpoint would put the
          gate screen back where it was: nowhere.
        */}
        {pages.length > 0 && (
          <div className="mt-8 border-t border-brand-black/10 pt-4 lg:hidden">
            <h2 className="pb-2 text-[10px] font-bold uppercase tracking-[0.1em] text-brand-black/50">
              {pagesLabel}
            </h2>
            <ul className="flex flex-wrap gap-2">
              {pages.map((page) => (
                <li key={page.href}>
                  <Link
                    href={page.href}
                    className="inline-flex items-center rounded-full border border-brand-black/20 px-3 py-1.5 text-sm font-medium text-brand-black hover:bg-brand-black/5"
                  >
                    {page.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
