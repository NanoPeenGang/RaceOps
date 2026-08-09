import { cn } from "@/lib/utils";

/**
 * Placeholders shaped like the thing that is loading.
 *
 * The app had 56 bare "Loading…" strings and one skeleton. The cost is not
 * ugliness, it is movement: a line of text is replaced by a table and
 * everything below it jumps, so people lose their place and occasionally tap
 * the wrong thing on the way past.
 *
 * These are shaped rather than generic. A grey box the size of the content
 * that follows keeps the page still; a spinner in the middle of the viewport
 * does not, and tells you less.
 *
 * Every skeleton is hidden from assistive technology and paired with a live
 * region that says "Loading" once. A screen reader announcing forty grey
 * rectangles is worse than the silence it replaced.
 */

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("animate-pulse rounded-md bg-brand-black/[0.07]", className)}
    />
  );
}

/**
 * Wraps a loading state so it is announced once, in words.
 *
 * `busy` rather than a live region full of boxes: the label is read when it
 * appears and the shapes below it stay silent.
 */
export function Loading({
  label = "Loading",
  children,
}: {
  label?: string;
  children: React.ReactNode;
}) {
  return (
    <div role="status" aria-busy="true" aria-label={label}>
      {children}
    </div>
  );
}

/** A page header's height, so the content below does not jump when it lands. */
export function HeaderSkeleton() {
  return (
    <div className="space-y-3 border-b border-brand-black/10 pb-5">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-8 w-72 max-w-full" />
      <Skeleton className="h-4 w-full max-w-md" />
    </div>
  );
}

/** A list of cards — the shape most consoles land in. */
export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          className="space-y-2 rounded-lg border border-brand-black/10 p-4"
        >
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      ))}
    </div>
  );
}

/** A row of headline numbers. */
export function StatsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="rounded-lg border border-brand-black/10 p-4">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="mt-2 h-7 w-16" />
        </div>
      ))}
    </div>
  );
}

/** A card grid — directories of teams, series, events and tracks. */
export function GridSkeleton({ cards = 6 }: { cards?: number }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: cards }, (_, index) => (
        <div
          key={index}
          className="space-y-3 rounded-lg border border-brand-black/10 p-4"
        >
          <div className="flex items-center gap-3">
            <Skeleton className="h-10 w-10 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
          <Skeleton className="h-3 w-full" />
        </div>
      ))}
    </div>
  );
}

/** A tabular console — timing sheets, payroll, standings. */
export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      <Skeleton className="h-8 w-full" />
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-10 w-full" />
      ))}
    </div>
  );
}

/** The whole page: header, then whatever shape the body is. */
export function PageSkeleton({
  label = "Loading",
  children,
}: {
  label?: string;
  children?: React.ReactNode;
}) {
  return (
    <Loading label={label}>
      <div className="space-y-6">
        <HeaderSkeleton />
        {children ?? <ListSkeleton />}
      </div>
    </Loading>
  );
}
