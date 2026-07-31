"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { TrackKind } from "@prisma/client";
import { api } from "@/lib/trpc/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, PageHeader, Section } from "@/components/ui/page";
import { TRACK_KIND_LABELS, formatLength } from "@/lib/tracks";
import { TrackDiagram } from "@/components/track-diagram";
import { formatTurns } from "@/lib/track-diagram";
import { REGION_LABELS, countryLabel, placeLabel } from "@/lib/regions";

/**
 * The venue directory.
 *
 * It ships populated — a few hundred real circuits and ovals — so the filters
 * carry more weight than the search box: somebody looking for a track near
 * them thinks in states, not in spellings. Paged rather than loaded whole,
 * because the list only grows.
 */
export default function TracksPage() {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<TrackKind | "">("");
  const [country, setCountry] = useState("");
  const [region, setRegion] = useState("");
  const [adding, setAdding] = useState(false);

  const facets = api.track.facets.useQuery();
  const tracks = api.track.list.useInfiniteQuery(
    {
      query: query.trim() || undefined,
      kind: kind || undefined,
      country: country || undefined,
      region: region || undefined,
      limit: 24,
    },
    { getNextPageParam: (page) => page.nextCursor },
  );

  const items = tracks.data?.pages.flatMap((page) => page.items) ?? [];

  // Only offer the states of the country in view; "Alabama" next to "Bavaria"
  // in one flat list helps nobody.
  const regions = useMemo(
    () =>
      (facets.data?.regions ?? []).filter(
        (row) => !country || row.country === country,
      ),
    [facets.data, country],
  );

  const filtered = Boolean(query.trim() || kind || country || region);
  const clear = () => {
    setQuery("");
    setKind("");
    setCountry("");
    setRegion("");
  };

  return (
    <div className="space-y-8">
      <PageHeader
        title="Tracks"
        description="Shared venue records. Linking an event to a layout is what lets incidents name a corner, lap records compare across series, and the same circuit stop being spelled four different ways."
        actions={
          <Button variant="primary" onClick={() => setAdding((open) => !open)}>
            {adding ? "Cancel" : "Add a track"}
          </Button>
        }
      />

      {adding && <AddTrackForm onCreated={() => setAdding(false)} />}

      <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-0 flex-1 text-sm font-medium sm:max-w-sm">
          <span className="sr-only">Search tracks</span>
          <input
            className="w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
            placeholder="Search by name, city or state"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>

        <select
          aria-label="Filter by kind"
          className="rounded-md border border-brand-black/20 px-3 py-2 text-sm"
          value={kind}
          onChange={(e) => setKind(e.target.value as TrackKind | "")}
        >
          <option value="">All kinds</option>
          {Object.entries(TRACK_KIND_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>

        {(facets.data?.countries.length ?? 0) > 1 && (
          <select
            aria-label="Filter by country"
            className="rounded-md border border-brand-black/20 px-3 py-2 text-sm"
            value={country}
            onChange={(e) => {
              setCountry(e.target.value);
              setRegion("");
            }}
          >
            <option value="">All countries</option>
            {facets.data?.countries.map((row) => (
              <option key={row.code} value={row.code}>
                {countryLabel(row.code)} ({row.count})
              </option>
            ))}
          </select>
        )}

        {regions.length > 1 && (
          <select
            aria-label="Filter by state or region"
            className="rounded-md border border-brand-black/20 px-3 py-2 text-sm"
            value={region}
            onChange={(e) => setRegion(e.target.value)}
          >
            <option value="">All states / regions</option>
            {regions.map((row) => (
              <option key={`${row.country}-${row.region}`} value={row.region}>
                {REGION_LABELS[row.region] ?? row.region} ({row.count})
              </option>
            ))}
          </select>
        )}

        {filtered && (
          <Button size="sm" variant="ghost" onClick={clear}>
            Clear
          </Button>
        )}
      </div>

      <Section
        title={
          items.length === 0
            ? "Directory"
            : `${items.length}${tracks.hasNextPage ? "+" : ""} track${
                items.length === 1 ? "" : "s"
              }`
        }
      >
        {tracks.isLoading && <p className="text-brand-black/60">Loading…</p>}

        {!tracks.isLoading && items.length === 0 && (
          <EmptyState
            title={filtered ? "No tracks match those filters" : "No tracks yet"}
            description={
              filtered
                ? "Widen the search, or add the venue you race at — everyone benefits from one good record of it."
                : "Add the venue you race at. Everyone benefits from one good record of it."
            }
            action={
              filtered ? (
                <Button size="sm" variant="outline" onClick={clear}>
                  Clear filters
                </Button>
              ) : (
                <Button size="sm" variant="primary" onClick={() => setAdding(true)}>
                  Add a track
                </Button>
              )
            }
          />
        )}

        <div className="grid gap-4 md:grid-cols-2">
          {items.map((track) => {
            const primary =
              track.layouts.find((layout) => layout.isPrimary) ??
              track.layouts[0];
            return (
              <Card key={track.id}>
                <CardHeader>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle>
                      <Link
                        href={`/tracks/${track.slug}`}
                        className="hover:text-brand-red"
                      >
                        {track.name}
                      </Link>
                    </CardTitle>
                    <div className="flex shrink-0 flex-wrap gap-1">
                      {track.isReference && (
                        <Badge
                          variant="outline"
                          title="Shipped with RaceOps. Anyone signed in can correct it."
                        >
                          Reference
                        </Badge>
                      )}
                      <Badge>{TRACK_KIND_LABELS[track.kind]}</Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="flex gap-3">
                  {primary && (primary.shape || primary.diagramUrl) && (
                    <div className="w-20 shrink-0">
                      <TrackDiagram
                        layout={{ ...primary, name: primary.name }}
                        className="[&_figcaption]:hidden"
                      />
                    </div>
                  )}
                  <div className="min-w-0 space-y-2">
                  <p className="text-xs text-brand-black/60">
                    {placeLabel(track) ?? "Location not given"}
                    {track.licenceGrade ? ` · ${track.licenceGrade}` : ""}
                  </p>
                  <p className="text-xs text-brand-black/60">
                    {track.layouts.length} layout
                    {track.layouts.length === 1 ? "" : "s"}
                    {track.layouts.length > 0
                      ? `: ${track.layouts
                          .map((layout) => layout.name)
                          .join(", ")}`
                      : ""}
                  </p>
                  {primary && (
                    <p className="text-xs tabular-nums text-brand-black/60">
                      {[
                        formatLength(primary.lengthMeters),
                        formatTurns(primary.turnCount),
                        primary.name,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {tracks.hasNextPage && (
          <div className="flex justify-center">
            <Button
              variant="outline"
              disabled={tracks.isFetchingNextPage}
              onClick={() => tracks.fetchNextPage()}
            >
              {tracks.isFetchingNextPage ? "Loading…" : "Show more tracks"}
            </Button>
          </div>
        )}
      </Section>
    </div>
  );
}

function AddTrackForm({ onCreated }: { onCreated: () => void }) {
  const utils = api.useUtils();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<TrackKind>(TrackKind.CIRCUIT);
  const [country, setCountry] = useState("");
  const [region, setRegion] = useState("");
  const [city, setCity] = useState("");
  const [licenceGrade, setLicenceGrade] = useState("");
  const [pitBoxCount, setPitBoxCount] = useState("");
  const [firstLayoutName, setFirstLayoutName] = useState("Full course");

  const create = api.track.create.useMutation({
    onSuccess: async () => {
      await utils.track.list.invalidate();
      onCreated();
    },
  });

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>Add a track</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-brand-black/60">
          You will be able to edit this track and add layouts to it. Other
          organizers can use it but not change it.
        </p>
        <label className="block text-sm font-medium">
          Name
          <input
            className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Circuit de Spa-Francorchamps"
          />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-medium">
            Kind
            <select
              className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
              value={kind}
              onChange={(e) => setKind(e.target.value as TrackKind)}
            >
              {Object.entries(TRACK_KIND_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-medium">
            First layout
            <input
              className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
              value={firstLayoutName}
              onChange={(e) => setFirstLayoutName(e.target.value)}
              placeholder="Grand Prix"
            />
          </label>
          <label className="block text-sm font-medium">
            City
            <input
              className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
              value={city}
              onChange={(e) => setCity(e.target.value)}
            />
          </label>
          <label className="block text-sm font-medium">
            Region / state
            <input
              className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
              value={region}
              onChange={(e) => setRegion(e.target.value)}
            />
          </label>
          <label className="block text-sm font-medium">
            Country code
            <input
              maxLength={2}
              className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm uppercase"
              value={country}
              onChange={(e) => setCountry(e.target.value.toUpperCase())}
              placeholder="BE"
            />
          </label>
          <label className="block text-sm font-medium">
            Licence grade
            <input
              className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
              value={licenceGrade}
              onChange={(e) => setLicenceGrade(e.target.value)}
              placeholder="FIA Grade 1 / Club / Regional"
            />
          </label>
          <label className="block text-sm font-medium">
            Pit boxes
            <input
              type="number"
              min={0}
              className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
              value={pitBoxCount}
              onChange={(e) => setPitBoxCount(e.target.value)}
            />
          </label>
        </div>
        {create.error && (
          <p className="text-sm text-brand-red">{create.error.message}</p>
        )}
        <Button
          variant="primary"
          disabled={create.isPending || name.trim().length < 2}
          onClick={() =>
            create.mutate({
              name: name.trim(),
              kind,
              country: country.trim().length === 2 ? country.trim() : undefined,
              region: region.trim() || undefined,
              city: city.trim() || undefined,
              licenceGrade: licenceGrade.trim() || undefined,
              pitBoxCount: pitBoxCount ? Number(pitBoxCount) : undefined,
              firstLayoutName: firstLayoutName.trim() || "Full course",
            })
          }
        >
          {create.isPending ? "Adding…" : "Add track"}
        </Button>
      </CardContent>
    </Card>
  );
}
