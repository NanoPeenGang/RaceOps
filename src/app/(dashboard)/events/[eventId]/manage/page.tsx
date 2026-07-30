"use client";

import { use, useState } from "react";
import Link from "next/link";
import {
  EventStatus,
  RegistrationStatus,
  VolunteerRoleType,
} from "@prisma/client";
import { api } from "@/lib/trpc/client";
import {
  EVENT_STATUS_LABELS,
  REGISTRATION_STATUS_LABELS,
  VOLUNTEER_ROLE_LABELS,
  canTransitionEvent,
  shiftCoverage,
} from "@/lib/events";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ResultsPanel, PenaltiesPanel } from "./race-control";
import { ResultsImportPanel } from "./results-import";
import { SchedulePanel } from "./schedule";
import { TimingConsole } from "./timing-console";
import { LineupsPanel } from "./lineups";
import { EligibilityPanel } from "./eligibility";
import { ScrutineeringPanel } from "./scrutineering";
import { TiresPanel } from "./tires";
import { PaddockPanel } from "./paddock";
import { OfficialsLogPanel } from "./officials-log";
import { WaiversPanel } from "./waivers";
import { GeneratedDocuments } from "@/components/generated-documents";
import { AnnouncementsPanel } from "@/components/announcements-panel";
import { DocumentsPanel } from "@/components/documents-panel";
import { DangerZone } from "@/components/danger-zone";
import { VenuePanel } from "@/components/venue-panel";
import { useRouter } from "next/navigation";

export default function ManageEventPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = use(params);
  const router = useRouter();
  const utils = api.useUtils();
  const event = api.event.byId.useQuery({ eventId });
  const setStatus = api.event.setStatus.useMutation({
    onSuccess: () => utils.event.byId.invalidate({ eventId }),
  });

  // Deletion is owner/admin only; race control can run an event, not erase it.
  const canDelete =
    event.data?.myRole === "OWNER" || event.data?.myRole === "ADMIN";
  const impact = api.event.deletionImpact.useQuery(
    { eventId },
    { enabled: canDelete, retry: false },
  );
  const deleteEvent = api.event.delete.useMutation({
    onSuccess: (result) => {
      utils.series.bySlug.invalidate();
      router.push(
        result.seriesId ? `/series` : "/events",
      );
    },
  });

  if (event.isLoading) return <p className="text-brand-black/60">Loading…</p>;
  if (event.error)
    return <p className="text-brand-red">{event.error.message}</p>;
  const data = event.data!;

  if (!data.myRole) {
    return (
      <p className="text-brand-red">
        You do not have permission to manage this event.
      </p>
    );
  }

  const transitions = Object.values(EventStatus).filter((s) =>
    canTransitionEvent(data.status, s),
  );

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href={`/events/${eventId}`}
            className="text-sm text-brand-red hover:underline"
          >
            ← {data.name}
          </Link>
          <h1 className="mt-1 text-3xl font-bold">Event control</h1>
          <p className="mt-1 text-sm text-brand-black/60">
            {data.series?.name} · {new Date(data.date).toLocaleString()}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant={data.status === "PUBLISHED" ? "verified" : "default"}
          >
            {EVENT_STATUS_LABELS[data.status]}
          </Badge>
          {transitions.map((status) => (
            <Button
              key={status}
              size="sm"
              variant={status === EventStatus.PUBLISHED ? "primary" : "outline"}
              disabled={setStatus.isPending}
              onClick={() => setStatus.mutate({ eventId, status })}
            >
              {status === EventStatus.PUBLISHED
                ? "Publish"
                : EVENT_STATUS_LABELS[status]}
            </Button>
          ))}
        </div>
      </div>
      {setStatus.error && (
        <p className="text-sm text-brand-red">{setStatus.error.message}</p>
      )}

      <div className="flex flex-wrap gap-2">
        <Link href={`/events/${eventId}/timing`}>
          <Button size="sm" variant="outline">
            View live timing board
          </Button>
        </Link>
        <Link href={`/events/${eventId}/incidents`}>
          <Button size="sm" variant="outline">
            Stewards&rsquo; queue
          </Button>
        </Link>
        <Link href={`/events/${eventId}/penalties`}>
          <Button size="sm" variant="outline">
            Public penalty record
          </Button>
        </Link>
        <Link href={`/events/${eventId}/bulletin`}>
          <Button size="sm" variant="outline">
            Official bulletin
          </Button>
        </Link>
      </div>

      <VenuePanel eventId={eventId} />
      <SchedulePanel eventId={eventId} />
      <TimingConsole eventId={eventId} />
      <RegistrationsPanel
        eventId={eventId}
        capacity={data.entryCapacity}
        seriesId={data.seriesId}
      />
      <LineupsPanel eventId={eventId} />
      <EligibilityPanel eventId={eventId} />
      <WaiversPanel eventId={eventId} />
      <ScrutineeringPanel eventId={eventId} seriesId={data.seriesId} />
      <TiresPanel eventId={eventId} />
      <PaddockPanel eventId={eventId} />
      <ResultsPanel eventId={eventId} />
      <ResultsImportPanel eventId={eventId} />
      <PenaltiesPanel eventId={eventId} />
      <OfficialsLogPanel eventId={eventId} />
      <ShiftsPanel eventId={eventId} />
      <AnnouncementsPanel scope={{ eventId }} canManage title="Event notices" />
      <GeneratedDocuments eventId={eventId} />
      <DocumentsPanel
        scope={{ eventId }}
        canManage
        title="Event documents"
      />

      {canDelete && (
        <DangerZone
          title="Delete this event"
          description="Removes the event and every entry, result, penalty and volunteer shift attached to it. To call off a race while keeping the record, cancel it instead."
          impact={impact.data}
          isLoadingImpact={impact.isLoading}
          isDeleting={deleteEvent.isPending}
          error={deleteEvent.error?.message ?? null}
          onDelete={(confirmName) =>
            deleteEvent.mutate({ eventId, confirmName })
          }
        />
      )}
    </div>
  );
}

function RegistrationsPanel({
  eventId,
  capacity,
  seriesId,
}: {
  eventId: string;
  capacity: number | null;
  seriesId: string | null;
}) {
  const utils = api.useUtils();
  const registrations = api.event.registrationsFor.useQuery({ eventId });
  const classes = api.series.classes.useQuery(
    { seriesId: seriesId ?? "" },
    { enabled: Boolean(seriesId) },
  );
  const setEntryClass = api.series.setEntryClass.useMutation({
    onSuccess: () => {
      utils.event.registrationsFor.invalidate({ eventId });
      utils.series.standings.invalidate();
    },
  });
  const setStatus = api.event.setRegistrationStatus.useMutation({
    onSuccess: () => {
      utils.event.registrationsFor.invalidate({ eventId });
      utils.event.byId.invalidate({ eventId });
    },
  });

  const confirmed =
    registrations.data?.filter((r) => r.status === "CONFIRMED").length ?? 0;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-semibold">Entries</h2>
        <p className="text-sm text-brand-black/60">
          {confirmed} confirmed{capacity ? ` / ${capacity}` : ""}
        </p>
      </div>
      {registrations.isLoading && (
        <p className="text-brand-black/60">Loading…</p>
      )}
      {registrations.data?.length === 0 && (
        <p className="text-brand-black/60">No entries yet.</p>
      )}
      <div className="space-y-2">
        {registrations.data?.map((registration) => (
          <Card key={registration.id}>
            <CardContent className="space-y-2 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium">
                    {registration.team?.name ??
                      registration.entrantUser?.profile?.displayName ??
                      "Unnamed entry"}
                  </p>
                  <p className="text-xs text-brand-black/60">
                    {[
                      registration.carNumber && `#${registration.carNumber}`,
                      registration.carClass,
                      registration.team ? "Team entry" : "Individual",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <Badge
                  variant={
                    registration.status === "CONFIRMED" ? "verified" : "default"
                  }
                >
                  {REGISTRATION_STATUS_LABELS[registration.status]}
                </Badge>
              </div>
              {registration.notes && (
                <p className="text-sm text-brand-black/80">
                  {registration.notes}
                </p>
              )}
              {classes.data && classes.data.length > 0 && (
                <label className="flex flex-wrap items-center gap-2 text-xs font-medium">
                  Class
                  <select
                    className="rounded-md border border-brand-black/20 px-2 py-1.5 text-xs"
                    value={registration.seriesClassId ?? ""}
                    disabled={setEntryClass.isPending}
                    onChange={(e) =>
                      setEntryClass.mutate({
                        registrationId: registration.id,
                        seriesClassId: e.target.value || null,
                      })
                    }
                  >
                    <option value="">Unclassified</option>
                    {classes.data.map((seriesClass) => (
                      <option key={seriesClass.id} value={seriesClass.id}>
                        {seriesClass.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {registration.status !== RegistrationStatus.WITHDRAWN && (
                <div className="flex flex-wrap gap-2">
                  {(
                    [
                      RegistrationStatus.CONFIRMED,
                      RegistrationStatus.WAITLISTED,
                      RegistrationStatus.REJECTED,
                    ] as RegistrationStatus[]
                  )
                    .filter((s) => s !== registration.status)
                    .map((status) => (
                      <Button
                        key={status}
                        size="sm"
                        variant={
                          status === RegistrationStatus.CONFIRMED
                            ? "primary"
                            : "outline"
                        }
                        disabled={setStatus.isPending}
                        onClick={() =>
                          setStatus.mutate({
                            registrationId: registration.id,
                            status,
                          })
                        }
                      >
                        {REGISTRATION_STATUS_LABELS[status]}
                      </Button>
                    ))}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
      {setStatus.error && (
        <p className="text-sm text-brand-red">{setStatus.error.message}</p>
      )}
    </section>
  );
}

function ShiftsPanel({ eventId }: { eventId: string }) {
  const utils = api.useUtils();
  const shifts = api.event.shiftsFor.useQuery({ eventId });
  const [showForm, setShowForm] = useState(false);

  const createShift = api.event.createShift.useMutation({
    onSuccess: () => {
      setShowForm(false);
      utils.event.shiftsFor.invalidate({ eventId });
      utils.event.byId.invalidate({ eventId });
    },
  });
  const deleteShift = api.event.deleteShift.useMutation({
    onSuccess: () => {
      utils.event.shiftsFor.invalidate({ eventId });
      utils.event.byId.invalidate({ eventId });
    },
  });

  const [role, setRole] = useState<VolunteerRoleType>(VolunteerRoleType.MARSHAL);
  const [title, setTitle] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [capacity, setCapacity] = useState("4");

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-semibold">Volunteer shifts</h2>
        <Button
          size="sm"
          variant="primary"
          onClick={() => setShowForm((v) => !v)}
        >
          {showForm ? "Cancel" : "Add shift"}
        </Button>
      </div>

      {showForm && (
        <Card className="max-w-2xl">
          <CardContent className="space-y-4 p-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm font-medium">
                Role
                <select
                  className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
                  value={role}
                  onChange={(e) =>
                    setRole(e.target.value as VolunteerRoleType)
                  }
                >
                  {Object.values(VolunteerRoleType).map((r) => (
                    <option key={r} value={r}>
                      {VOLUNTEER_ROLE_LABELS[r]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm font-medium">
                Title
                <input
                  className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Turn 5 marshal post"
                />
              </label>
              <label className="block text-sm font-medium">
                Starts
                <input
                  type="datetime-local"
                  className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
                  value={startsAt}
                  onChange={(e) => setStartsAt(e.target.value)}
                />
              </label>
              <label className="block text-sm font-medium">
                Ends
                <input
                  type="datetime-local"
                  className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
                  value={endsAt}
                  onChange={(e) => setEndsAt(e.target.value)}
                />
              </label>
              <label className="block text-sm font-medium">
                Volunteers needed
                <input
                  type="number"
                  min={1}
                  className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
                  value={capacity}
                  onChange={(e) => setCapacity(e.target.value)}
                />
              </label>
            </div>
            {createShift.error && (
              <p className="text-sm text-brand-red">
                {createShift.error.message}
              </p>
            )}
            <Button
              variant="primary"
              disabled={
                createShift.isPending ||
                title.trim().length < 2 ||
                !startsAt ||
                !endsAt
              }
              onClick={() =>
                createShift.mutate({
                  eventId,
                  role,
                  title: title.trim(),
                  startsAt: new Date(startsAt),
                  endsAt: new Date(endsAt),
                  capacity: Number(capacity) || 1,
                })
              }
            >
              {createShift.isPending ? "Adding…" : "Add shift"}
            </Button>
          </CardContent>
        </Card>
      )}

      {shifts.data?.length === 0 && (
        <p className="text-brand-black/60">No shifts yet.</p>
      )}
      <div className="space-y-2">
        {shifts.data?.map((shift) => {
          const coverage = shiftCoverage(shift.capacity, shift.signups);
          return (
            <Card key={shift.id}>
              <CardContent className="space-y-2 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium">{shift.title}</p>
                    <p className="text-xs text-brand-black/60">
                      {VOLUNTEER_ROLE_LABELS[shift.role]} ·{" "}
                      {new Date(shift.startsAt).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={coverage.isFull ? "verified" : "default"}>
                      {coverage.filled}/{coverage.capacity} filled
                    </Badge>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={deleteShift.isPending}
                      onClick={() => deleteShift.mutate({ shiftId: shift.id })}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
                {shift.signups.length > 0 && (
                  <ul className="flex flex-wrap gap-2">
                    {shift.signups
                      .filter((s) => s.status !== "CANCELED")
                      .map((signup) => (
                        <li key={signup.id}>
                          <Badge>
                            {signup.user.profile?.displayName ?? "Unnamed"}
                            {signup.status === "WAITLISTED" ? " (waiting)" : ""}
                          </Badge>
                        </li>
                      ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
      {deleteShift.error && (
        <p className="text-sm text-brand-red">{deleteShift.error.message}</p>
      )}
    </section>
  );
}
