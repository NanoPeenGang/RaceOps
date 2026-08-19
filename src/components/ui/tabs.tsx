"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * Tabs that survive a reload and a shared link.
 *
 * The state lives in the query string rather than in component state. An
 * official who reloads mid-meeting should land back on the timing tab, and
 * "look at the scrutineering screen" should be a link someone can send — both
 * impossible with local state, and both things people try immediately.
 */

export interface TabDefinition {
  id: string;
  label: string;
  /** A count or a dot; how a tab says it needs attention without being read. */
  badge?: React.ReactNode;
  /** Hidden entirely when false — a tab nobody can use is noise. */
  visible?: boolean;
  content: React.ReactNode;
}

export interface TabsProps {
  tabs: TabDefinition[];
  /** Query-string key, so two tab sets on one page do not fight. */
  param?: string;
  className?: string;
}

/**
 * Wrapped in Suspense because the state lives in the query string.
 *
 * `useSearchParams` opts a component out of prerendering unless a boundary
 * sits above it, and without one Next refuses to build any *static* page that
 * uses tabs. Putting the boundary here rather than in each page means the next
 * console to reach for tabs cannot hit that, and the fallback is the tab bar's
 * own height so the page does not jump when it resolves.
 */
export function Tabs(props: TabsProps) {
  return (
    <Suspense
      fallback={
        <div
          className={cn("h-10 border-b border-brand-black/10", props.className)}
        />
      }
    >
      <TabsInner {...props} />
    </Suspense>
  );
}

function TabsInner({ tabs, param = "tab", className }: TabsProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const visible = tabs.filter((tab) => tab.visible !== false);
  const requested = searchParams.get(param);
  const fallback = visible[0]?.id ?? "";
  // An unknown or now-hidden tab falls back rather than rendering nothing —
  // a stale bookmark should still open the page.
  const active = visible.some((tab) => tab.id === requested)
    ? requested!
    : fallback;

  // Mirrored into state so a click paints immediately rather than waiting on
  // the router; the URL catches up a frame later.
  const [optimistic, setOptimistic] = useState(active);
  useEffect(() => setOptimistic(active), [active]);

  const select = (id: string) => {
    setOptimistic(id);
    const next = new URLSearchParams(searchParams.toString());
    next.set(param, id);
    // `scroll: false` keeps the person where they were; jumping to the top on
    // every tab change loses their place in a long console.
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };

  const current = visible.find((tab) => tab.id === optimistic) ?? visible[0];

  /*
   * Whether the bar is wider than its box, remeasured on resize and whenever
   * the set of tabs changes. Assuming it overflows would put a permanent fade
   * over the last tab on a desktop where everything already fits.
   */
  const barRef = useRef<HTMLDivElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const measure = () => setOverflowing(bar.scrollWidth > bar.clientWidth + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(bar);
    return () => observer.disconnect();
  }, [visible.length]);

  return (
    <div className={className}>
      {/*
        Wrapped so the bar can carry a fade at its right edge.

        The bar scrolls rather than wraps — a wrapped set of seven tabs takes
        half a phone screen before any content appears — but a scrollable strip
        with a hard edge looks like a complete list that happens to end, so the
        tabs past the fold were simply not found. The gradient is the one thing
        that says "there is more this way"; it is hidden once the bar fits, so
        it never lies about content that is not there.
      */}
      <div className="relative">
        <div
          ref={barRef}
          role="tablist"
          aria-orientation="horizontal"
          className="-mx-1 flex gap-1 overflow-x-auto border-b border-brand-black/10 px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {visible.map((tab) => {
            const isActive = tab.id === optimistic;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                id={`tab-${tab.id}`}
                aria-selected={isActive}
                aria-controls={`panel-${tab.id}`}
                onClick={() => select(tab.id)}
                className={cn(
                  "shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "border-brand-red text-brand-black"
                    : "border-transparent text-brand-black/60 hover:text-brand-black",
                )}
              >
                {tab.label}
                {tab.badge !== undefined && tab.badge !== null && (
                  <span className="ml-1.5 rounded-full bg-brand-black/10 px-1.5 py-0.5 text-xs tabular-nums">
                    {tab.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {/*
          Fades the right edge while there is more to reach. `aria-hidden` and
          `pointer-events-none`: it is a hint about scrolling, not a control,
          and it must never sit between a thumb and a tab.
        */}
        {overflowing && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-brand-offwhite to-transparent"
          />
        )}
      </div>

      {current && (
        <div
          role="tabpanel"
          id={`panel-${current.id}`}
          aria-labelledby={`tab-${current.id}`}
          className="pt-6"
        >
          {current.content}
        </div>
      )}
    </div>
  );
}
