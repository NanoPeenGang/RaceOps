"use client";

import { use, useState } from "react";
import Link from "next/link";
import { EventStatus } from "@prisma/client";
import { api } from "@/lib/trpc/client";
import { EVENT_STATUS_LABELS } from "@/lib/events";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DangerZone } from "@/components/danger-zone";
import { useRouter } from "next/navigation";

export default function SeriesDashboardPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  const router = useRouter();
  const utils = api.useUtils();
  const series = api.series.bySlug.useQuery({ slug });
  const [showEventForm, setShowEventForm] = useState(false);

  const isOwner = series.data?.myRole === "OWNER";
  const impact = api.series.deletionImpact.useQuery(
    { seriesId: series.data?.id ?? "" },
    { enabled: Boolean(series.data?.id) && isOwner, retry: false },
  );
  const deleteSeries = api.series.delete.useMutation({
    onSuccess: () => {
      utils.series.mine.invalidate();
      utils.series.list.invalidate();
      router.push("/series");
    },
  });

  if (series.isLoading) {
    return <p className="text-brand-black/60">Loading…</p>;
  }
  if (series.error) {
    return <p className="text-brand-red">{series.error.message}</p>;
  }
  const data = series.data!;
  const canManage = Boolean(data.myRole);

  const totalConfirmed = data.events.reduce(
    (sum, e) => sum + e.confirmedEntries,
    0,
  );
  const coverage = data.events.reduce(
    (acc, e) => ({
      needed: acc.needed + e.volunteerCoverage.needed,
      filled: acc.filled + e.volunteerCoverage.filled,
    }),
    { needed: 0, filled: 0 },
  );

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">{data.name}</h1>
          <p className="mt-1 text-sm text-brand-black/60">
            {data.platform}
            {data.season ? ` · ${data.season}` : ""} ·{" "}
            {data.discipline === "SIM" ? "Sim racing" : "Real world"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/series/${slug}/standings`}>
            <Button variant="outline">Standings</Button>
          </Link>
          {canManage && (
            <Button variant="primary" onClick={() => setShowEventForm((v) => !v)}>
              {showEventForm ? "Cancel" : "Add event"}
            </Button>
          )}
        </div>
      </div>

      {data.description && (
        <p className="max-w-3xl text-sm text-brand-black/80">
          {data.description}
        </p>
      )}

      {/* Series-wide summary — the "whole series from one spot" view. */}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Events" value={data.events.length} />
        <StatCard label="Confirmed entries" value={totalConfirmed} />
        <StatCard
          label="Volunteer coverage"
          value={
            coverage.needed === 0
              ? "—"
              : `${coverage.filled}/${coverage.needed}`
          }
        />
      </div>

      {showEventForm && (
        <CreateEventForm
          seriesId={data.id}
          onCreated={() => {
            setShowEventForm(false);
            utils.series.bySlug.invalidate({ slug });
          }}
        />
      )}

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Calendar</h2>
        {data.events.length === 0 && (
          <p className="text-brand-black/60">No events scheduled yet.</p>
        )}
        <div className="space-y-3">
          {data.events.map((event) => (
            <Card key={event.id}>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle>{event.name}</CardTitle>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant={
                        event.status === EventStatus.PUBLISHED
                          ? "verified"
                          : "default"
                      }
                    >
                      {EVENT_STATUS_LABELS[event.status]}
                    </Badge>
                    <span className="text-xs text-brand-black/60">
                      {new Date(event.date).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-xs text-brand-black/60">
                  {[event.venue, event.platform].filter(Boolean).join(" · ")}
                </p>
                <div className="flex flex-wrap gap-4 text-xs text-brand-black/70">
                  <span>
                    <strong>{event.confirmedEntries}</strong> confirmed
                    {event.entryCapacity ? ` / ${event.entryCapacity}` : ""}
                  </span>
                  <span>
                    <strong>{event._count.registrations}</strong> total entries
                  </span>
                  {event.volunteerCoverage.needed > 0 && (
                    <span>
                      Volunteers{" "}
                      <strong>
                        {event.volunteerCoverage.filled}/
                        {event.volunteerCoverage.needed}
                      </strong>
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-2 pt-1">
                  <Link href={`/events/${event.id}`}>
                    <Button size="sm" variant="outline">
                      View
                    </Button>
                  </Link>
                  {canManage && (
                    <Link href={`/events/${event.id}/manage`}>
                      <Button size="sm" variant="primary">
                        Manage
                      </Button>
                    </Link>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Organizers</h2>
        <div className="flex flex-wrap gap-2">
          {data.organizers.map((organizer) => (
            <Badge key={organizer.id}>
              {organizer.user.profile?.displayName ?? "Unnamed"} ·{" "}
              {organizer.role.replace("_", " ").toLowerCase()}
            </Badge>
          ))}
        </div>
      </section>

      {isOwner && (
        <DangerZone
          title="Delete this series"
          description="Removes the series, its whole calendar and every entry, result and penalty under it. This cannot be undone."
          impact={impact.data}
          isLoadingImpact={impact.isLoading}
          isDeleting={deleteSeries.isPending}
          error={deleteSeries.error?.message ?? null}
          onDelete={(confirmName) =>
            deleteSeries.mutate({ seriesId: data.id, confirmName })
          }
        />
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <p className="text-xs text-brand-black/60">{label}</p>
        <p className="mt-1 text-2xl font-bold">{value}</p>
      </CardContent>
    </Card>
  );
}

function CreateEventForm({
  seriesId,
  onCreated,
}: {
  seriesId: string;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  const [platform, setPlatform] = useState("");
  const [venue, setVenue] = useState("");
  const [entryCapacity, setEntryCapacity] = useState("");
  const [opensAt, setOpensAt] = useState("");
  const [closesAt, setClosesAt] = useState("");

  const create = api.event.create.useMutation({ onSuccess: onCreated });

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>New event</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <label className="block text-sm font-medium">
          Event name
          <input
            className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Round 1 — 6 Hours of Spa"
          />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-medium">
            Date & time
            <input
              type="datetime-local"
              className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <label className="block text-sm font-medium">
            Platform
            <input
              className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
              value={platform}
              onChange={(e) => setPlatform(e.target.value)}
              placeholder="iRacing / Circuit de Spa"
            />
          </label>
          <label className="block text-sm font-medium">
            Venue
            <input
              className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
              value={venue}
              onChange={(e) => setVenue(e.target.value)}
              placeholder="Spa-Francorchamps"
            />
          </label>
          <label className="block text-sm font-medium">
            Entry capacity
            <input
              type="number"
              min={1}
              className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
              value={entryCapacity}
              onChange={(e) => setEntryCapacity(e.target.value)}
              placeholder="Unlimited"
            />
          </label>
          <label className="block text-sm font-medium">
            Registration opens
            <input
              type="datetime-local"
              className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
              value={opensAt}
              onChange={(e) => setOpensAt(e.target.value)}
            />
          </label>
          <label className="block text-sm font-medium">
            Registration closes
            <input
              type="datetime-local"
              className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
              value={closesAt}
              onChange={(e) => setClosesAt(e.target.value)}
            />
          </label>
        </div>
        {create.error && (
          <p className="text-sm text-brand-red">{create.error.message}</p>
        )}
        <Button
          variant="primary"
          disabled={
            create.isPending ||
            name.trim().length < 2 ||
            !date ||
            platform.trim().length < 1
          }
          onClick={() =>
            create.mutate({
              seriesId,
              name: name.trim(),
              date: new Date(date),
              platform: platform.trim(),
              venue: venue.trim() || undefined,
              entryCapacity: entryCapacity ? Number(entryCapacity) : undefined,
              registrationOpensAt: opensAt ? new Date(opensAt) : undefined,
              registrationClosesAt: closesAt ? new Date(closesAt) : undefined,
            })
          }
        >
          {create.isPending ? "Creating…" : "Create event"}
        </Button>
      </CardContent>
    </Card>
  );
}
