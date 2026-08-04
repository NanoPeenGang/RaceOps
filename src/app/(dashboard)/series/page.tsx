"use client";

import { useState } from "react";
import Link from "next/link";
import { SeriesDiscipline } from "@prisma/client";
import { api } from "@/lib/trpc/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function SeriesPage() {
  const utils = api.useUtils();
  const mine = api.series.mine.useQuery();
  const all = api.series.list.useQuery({});
  const [showForm, setShowForm] = useState(false);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">Series</h1>
          <p className="mt-1 text-sm text-brand-black/60">
            Run a championship: schedule events, take entries, and staff
            volunteers from one place.
          </p>
        </div>
        <Button variant="primary" onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Cancel" : "Create a series"}
        </Button>
      </div>

      {showForm && (
        <CreateSeriesForm
          onCreated={() => {
            setShowForm(false);
            utils.series.mine.invalidate();
            utils.series.list.invalidate();
          }}
        />
      )}

      {mine.data && mine.data.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Series you organize</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {mine.data.map((series) => (
              // Organizers land in the console; the public page is one click on.
              <Link key={series.id} href={`/series/${series.slug}/manage`}>
                <Card className="h-full transition-colors hover:border-brand-red/50">
                  <CardHeader>
                    <div className="flex items-center justify-between gap-2">
                      <CardTitle>{series.name}</CardTitle>
                      <Badge variant="verified">
                        {series.myRole.replace(/_/g, " ").toLowerCase()}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-xs text-brand-black/60">
                      {series.platform} · {series._count.events} event
                      {series._count.events === 1 ? "" : "s"}
                      {series.season ? ` · ${series.season}` : ""}
                    </p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">All series</h2>
        {all.isLoading && <p className="text-brand-black/60">Loading…</p>}
        {all.data?.items.length === 0 && (
          <p className="text-brand-black/60">
            No series yet — create the first one.
          </p>
        )}
        <div className="grid gap-4 md:grid-cols-2">
          {all.data?.items.map((series) => (
            <Link key={series.id} href={`/series/${series.slug}`}>
              <Card className="h-full transition-colors hover:border-brand-red/50">
                <CardHeader>
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle>{series.name}</CardTitle>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {/* Says up front that nobody runs this copy, so the
                          absence of an "enter" path is not a bug. */}
                      {series.isReference && (
                        <Badge variant="outline">Reference</Badge>
                      )}
                      <Badge>
                        {series.discipline === SeriesDiscipline.SIM
                          ? "Sim"
                          : "Real world"}
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-1">
                  {series.description && (
                    <p className="line-clamp-2 text-sm text-brand-black/80">
                      {series.description}
                    </p>
                  )}
                  <p className="text-xs text-brand-black/60">
                    {series.platform} · {series._count.events} event
                    {series._count.events === 1 ? "" : "s"}
                  </p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

function CreateSeriesForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("");
  const [discipline, setDiscipline] = useState<SeriesDiscipline>(
    SeriesDiscipline.SIM,
  );
  const [platform, setPlatform] = useState("");
  const [season, setSeason] = useState("");
  const [description, setDescription] = useState("");

  const create = api.series.create.useMutation({ onSuccess: onCreated });

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>New series</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <label className="block text-sm font-medium">
          Series name
          <input
            className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Apex Endurance Championship"
          />
        </label>
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="block text-sm font-medium">
            Discipline
            <select
              className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
              value={discipline}
              onChange={(e) =>
                setDiscipline(e.target.value as SeriesDiscipline)
              }
            >
              <option value={SeriesDiscipline.SIM}>Sim racing</option>
              <option value={SeriesDiscipline.REAL_WORLD}>Real world</option>
            </select>
          </label>
          <label className="block text-sm font-medium">
            Platform / sanctioning body
            <input
              className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
              value={platform}
              onChange={(e) => setPlatform(e.target.value)}
              placeholder="iRacing / SRO"
            />
          </label>
          <label className="block text-sm font-medium">
            Season
            <input
              className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
              value={season}
              onChange={(e) => setSeason(e.target.value)}
              placeholder="2026"
            />
          </label>
        </div>
        <label className="block text-sm font-medium">
          Description
          <textarea
            className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Format, classes, eligibility…"
          />
        </label>
        {create.error && (
          <p className="text-sm text-brand-red">{create.error.message}</p>
        )}
        <Button
          variant="primary"
          disabled={
            create.isPending ||
            name.trim().length < 2 ||
            platform.trim().length < 1
          }
          onClick={() =>
            create.mutate({
              name: name.trim(),
              discipline,
              platform: platform.trim(),
              season: season.trim() || undefined,
              description: description.trim() || undefined,
            })
          }
        >
          {create.isPending ? "Creating…" : "Create series"}
        </Button>
      </CardContent>
    </Card>
  );
}
