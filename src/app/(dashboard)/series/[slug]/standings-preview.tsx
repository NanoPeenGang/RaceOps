"use client";

import Link from "next/link";
import { api } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";

const PREVIEW_ROWS = 5;

/** Top of the championship table on the landing page, linking to the full one. */
export function StandingsPreview({
  seriesId,
  slug,
}: {
  seriesId: string;
  slug: string;
}) {
  const standings = api.series.standings.useQuery({ seriesId });
  const rows = standings.data?.rows ?? [];
  // Nothing scored yet is the normal state before round one — stay quiet.
  if (rows.length === 0) return null;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-semibold">Championship</h2>
        <Link href={`/series/${slug}/standings`}>
          <Button size="sm" variant="outline">
            Full table
          </Button>
        </Link>
      </div>
      <ol className="divide-y divide-brand-black/5 rounded-lg border border-brand-black/10">
        {rows.slice(0, PREVIEW_ROWS).map((row, index) => (
          <li
            key={row.competitorKey}
            className="flex items-center gap-3 px-4 py-2.5 text-sm"
          >
            <span className="w-6 text-center font-bold">{index + 1}</span>
            <span className="min-w-0 flex-1 truncate font-medium">
              {row.competitorLabel}
            </span>
            <span className="text-xs text-brand-black/60">
              {row.wins > 0 ? `${row.wins}W · ` : ""}
              {row.starts} start{row.starts === 1 ? "" : "s"}
            </span>
            <span className="w-12 text-right font-semibold tabular-nums">
              {row.points}
            </span>
          </li>
        ))}
      </ol>
      {rows.length > PREVIEW_ROWS && (
        <p className="text-xs text-brand-black/60">
          {rows.length - PREVIEW_ROWS} more classified.
        </p>
      )}
    </section>
  );
}
