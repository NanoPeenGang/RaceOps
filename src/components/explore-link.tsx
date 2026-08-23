import Link from "next/link";
import type { ExploreType } from "@/lib/explore";

/**
 * The bridge from a directory page to Explore.
 *
 * These four pages kept their URLs and the things a search cannot do — making
 * a team, seeing your own entries — but browsing moved. This says so where
 * somebody already is, rather than leaving them to notice the header changed.
 */
export function ExploreLink({ type, what }: { type: ExploreType; what: string }) {
  return (
    <Link
      href={`/explore?type=${type}`}
      className="flex items-center gap-3 rounded-xl border border-dashed border-brand-black/20 px-4 py-3 transition-colors hover:border-brand-red hover:bg-brand-black/5"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="h-5 w-5 shrink-0 text-brand-black/50"
      >
        <circle cx="10.6" cy="10.6" r="6.6" />
        <path d="m20 20-4.7-4.7" />
      </svg>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-brand-black">
          Search {what} in Explore
        </span>
        <span className="block text-xs text-brand-black/60">
          Filter by discipline, date, region and series — across everything at once.
        </span>
      </span>
      <span aria-hidden="true" className="shrink-0 text-brand-red">
        →
      </span>
    </Link>
  );
}
