"use client";

import { Suspense, useEffect, useState } from "react";
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
          className={cn(
            "h-10 border-b border-brand-black/10",
            props.className,
          )}
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

  return (
    <div className={className}>
      <div
        role="tablist"
        aria-orientation="horizontal"
        // Horizontally scrollable rather than wrapped: on a phone a wrapped
        // tab bar can take half the screen before any content appears.
        className="-mx-1 flex gap-1 overflow-x-auto border-b border-brand-black/10 px-1"
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
