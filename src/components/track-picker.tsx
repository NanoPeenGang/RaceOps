"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/trpc/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { REGION_LABELS, countryLabel, placeLabel } from "@/lib/regions";
import { formatTurns } from "@/lib/track-diagram";
import { formatLength } from "@/lib/tracks";

/**
 * Choosing a venue from the shared track directory.
 *
 * The directory ships with a few hundred real circuits, and until this existed
 * the only way to set an event's venue while creating it was to type its name
 * into a free-text box — which links to nothing, so the meeting got no map, no
 * corner references and no lap records. Typing is still allowed and always
 * will be, because a hillclimb on someone's estate has no Track record and
 * does not need one. It just should not be the only option, or the easy one.
 *
 * Filters by state as well as by name because somebody scheduling a round
 * thinks in geography: "what have we got in Ohio" is a more natural question
 * than the exact spelling of a circuit's current sponsor name.
 */
export function TrackPicker({
  value,
  onSelect,
  onClear,
  disabled,
}: {
  /** The layout currently chosen, so it can be shown and cleared. */
  value?: {
    id: string;
    name: string;
    track: { name: string; slug: string };
  } | null;
  onSelect: (layoutId: string, label: string) => void;
  onClear?: () => void;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [region, setRegion] = useState("");

  const facets = api.track.facets.useQuery();
  const tracks = api.track.list.useQuery({
    query: query.trim() || undefined,
    region: region || undefined,
    limit: 20,
  });

  // Every region in the directory, deduplicated across countries so the list
  // is short enough to scan.
  const regions = useMemo(() => {
    const seen = new Map<string, number>();
    for (const row of facets.data?.regions ?? []) {
      seen.set(row.region, (seen.get(row.region) ?? 0) + row.count);
    }
    return [...seen.entries()]
      .map(([code, count]) => ({
        code,
        label: REGION_LABELS[code] ?? code,
        count,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [facets.data]);

  const items = tracks.data?.items ?? [];

  return (
    <div className="space-y-3">
      {value && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-brand-black/15 bg-brand-black/[0.03] px-3 py-2">
          <p className="text-sm">
            <span className="font-medium">{value.track.name}</span>
            <span className="text-brand-black/60"> — {value.name}</span>
          </p>
          <div className="flex items-center gap-2">
            <Link
              href={`/tracks/${value.track.slug}`}
              className="text-xs text-brand-red hover:underline"
            >
              View track ↗
            </Link>
            {onClear && (
              <Button
                size="sm"
                variant="ghost"
                disabled={disabled}
                onClick={onClear}
              >
                Clear
              </Button>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <input
          className="min-w-0 flex-1 rounded-md border border-brand-black/20 px-3 py-2 text-sm"
          placeholder="Search by track, city or state"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {regions.length > 1 && (
          <select
            aria-label="Filter tracks by state or region"
            className="rounded-md border border-brand-black/20 px-2 py-2 text-sm"
            value={region}
            onChange={(e) => setRegion(e.target.value)}
          >
            <option value="">All states</option>
            {regions.map((row) => (
              <option key={row.code} value={row.code}>
                {row.label} ({row.count})
              </option>
            ))}
          </select>
        )}
      </div>

      {tracks.isLoading && (
        <p className="text-sm text-brand-black/60">Loading tracks…</p>
      )}

      {!tracks.isLoading && items.length === 0 && (
        <p className="text-sm text-brand-black/60">
          Nothing matches.{" "}
          <Link href="/tracks" className="text-brand-red hover:underline">
            Add the track
          </Link>{" "}
          and it will be here — and on every other series&rsquo; picker too.
        </p>
      )}

      {items.length > 0 && (
        <ul className="max-h-80 space-y-2 overflow-y-auto pr-1">
          {items.map((track) => (
            <li
              key={track.id}
              className="rounded-md border border-brand-black/10 p-3"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-medium">{track.name}</p>
                <p className="text-xs text-brand-black/55">
                  {placeLabel(track) ?? countryLabel(track.country)}
                </p>
              </div>

              <div className="mt-2 flex flex-wrap gap-2">
                {track.layouts.length === 0 ? (
                  <p className="text-xs text-brand-black/55">
                    No layouts on this track yet.
                  </p>
                ) : (
                  track.layouts.map((layout) => (
                    <Button
                      key={layout.id}
                      size="sm"
                      variant={value?.id === layout.id ? "primary" : "outline"}
                      disabled={disabled}
                      onClick={() =>
                        onSelect(layout.id, `${track.name} — ${layout.name}`)
                      }
                    >
                      {layout.name}
                      {layout.platform ? ` (${layout.platform})` : ""}
                    </Button>
                  ))
                )}
              </div>

              {track.layouts.length > 0 && (
                <p className="mt-1.5 flex flex-wrap gap-x-3 text-xs text-brand-black/50">
                  {track.layouts.slice(0, 3).map((layout) => {
                    const specs = [
                      formatLength(layout.lengthMeters),
                      formatTurns(layout.turnCount),
                    ]
                      .filter(Boolean)
                      .join(" · ");
                    return specs ? (
                      <span key={layout.id}>
                        {layout.name}: {specs}
                      </span>
                    ) : null;
                  })}
                </p>
              )}

              {track.isReference && (
                <Badge variant="outline" className="mt-2">
                  Reference
                </Badge>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
