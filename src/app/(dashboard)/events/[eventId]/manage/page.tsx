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

export default function ManageEventPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = use(params);
  const utils = api.useUtils();
  const event = api.event.byId.useQuery({ eventId });
  const setStatus = api.event.setStatus.useMutation({
    onSuccess: () => utils.event.byId.invalidate({ eventId }),
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

      <RegistrationsPanel eventId={eventId} capacity={data.entryCapacity} />
      <ResultsPanel eventId={eventId} />
      <PenaltiesPanel eventId={eventId} />
      <ShiftsPanel eventId={eventId} />
    </div>
  );
}

function RegistrationsPanel({
  eventId,
  capacity,
}: {
  eventId: string;
  capacity: number | null;
}) {
  const utils = api.useUtils();
  const registrations = api.event.registrationsFor.useQuery({ eventId });
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
