"use client";

import { useState } from "react";
import Link from "next/link";
import { TrackKind } from "@prisma/client";
import { api } from "@/lib/trpc/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TRACK_KIND_LABELS } from "@/lib/tracks";

export default function TracksPage() {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<TrackKind | "">("");
  const [adding, setAdding] = useState(false);

  const tracks = api.track.list.useQuery({
    query: query.trim() || undefined,
    kind: kind || undefined,
  });

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">Tracks</h1>
          <p className="mt-1 max-w-2xl text-sm text-brand-black/60">
            Shared venue records. Linking an event to a layout is what lets
            incidents name a corner, lap records compare across series, and the
            same circuit stop being spelled four different ways.
          </p>
        </div>
        <Button variant="primary" onClick={() => setAdding((open) => !open)}>
          {adding ? "Cancel" : "Add a track"}
        </Button>
      </div>

      {adding && <AddTrackForm onCreated={() => setAdding(false)} />}

      <div className="flex flex-wrap gap-3">
        <input
          className="min-w-0 flex-1 rounded-md border border-brand-black/20 px-3 py-2 text-sm sm:max-w-sm"
          placeholder="Search by name, city or region"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
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
      </div>

      {tracks.isLoading && <p className="text-brand-black/60">Loading…</p>}
      {tracks.data?.items.length === 0 && (
        <p className="text-brand-black/60">
          No tracks match. Add the venue you race at — everyone benefits from
          one good record of it.
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {tracks.data?.items.map((track) => (
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
                <Badge>{TRACK_KIND_LABELS[track.kind]}</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-xs text-brand-black/60">
                {[track.city, track.region, track.country]
                  .filter(Boolean)
                  .join(", ") || "Location not given"}
                {track.licenceGrade ? ` · ${track.licenceGrade}` : ""}
              </p>
              <p className="text-xs text-brand-black/60">
                {track.layouts.length} layout
                {track.layouts.length === 1 ? "" : "s"}
                {track.layouts.length > 0
                  ? `: ${track.layouts.map((layout) => layout.name).join(", ")}`
                  : ""}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
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
