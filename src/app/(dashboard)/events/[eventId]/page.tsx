"use client";

import { use, useState } from "react";
import Link from "next/link";
import type { inferRouterOutputs } from "@trpc/server";
import { api } from "@/lib/trpc/client";
import type { AppRouter } from "@/server/trpc/root";
import {
  EVENT_STATUS_LABELS,
  REGISTRATION_STATUS_LABELS,
  VOLUNTEER_ROLE_LABELS,
  shiftCoverage,
} from "@/lib/events";
import { SESSION_TYPE_LABELS, groupSessionsByDay } from "@/lib/schedule";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AnnouncementsPanel } from "@/components/announcements-panel";
import { DocumentsPanel } from "@/components/documents-panel";
import { MediaPanel } from "@/components/media-panel";
import { PaddockChat } from "@/components/paddock-chat";

const WINDOW_MESSAGES: Record<string, string> = {
  not_published: "Registration has not opened — this event is still a draft.",
  not_yet_open: "Registration has not opened yet.",
  closed: "Registration for this event has closed.",
  event_canceled: "This event has been canceled.",
};

export default function EventDetailPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = use(params);
  const utils = api.useUtils();
  const event = api.event.byId.useQuery({ eventId });

  if (event.isLoading) return <p className="text-brand-black/60">Loading…</p>;
  if (event.error)
    return <p className="text-brand-red">{event.error.message}</p>;
  const data = event.data!;

  const refresh = () => utils.event.byId.invalidate({ eventId });

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">{data.name}</h1>
          <p className="mt-1 text-sm text-brand-black/60">
            {[
              data.series?.name,
              data.venue,
              data.platform,
              new Date(data.date).toLocaleString(),
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant={data.status === "PUBLISHED" ? "verified" : "default"}
          >
            {EVENT_STATUS_LABELS[data.status]}
          </Badge>
          <Link href={`/events/${eventId}/timing`}>
            <Button size="sm" variant="outline">
              Live timing
            </Button>
          </Link>
          <Link href={`/events/${eventId}/penalties`}>
            <Button size="sm" variant="outline">
              Penalties
            </Button>
          </Link>
          {data.myRole && (
            <Link href={`/events/${eventId}/manage`}>
              <Button size="sm" variant="primary">
                Manage
              </Button>
            </Link>
          )}
        </div>
      </div>

      {data.description && (
        <p className="max-w-3xl whitespace-pre-wrap text-sm text-brand-black/80">
          {data.description}
        </p>
      )}

      <RunningOrder eventId={eventId} />

      <div className="grid gap-6 lg:grid-cols-2">
        <RegistrationPanel event={data} onChanged={refresh} />
        <VolunteerPanel event={data} onChanged={refresh} />
      </div>

      <AnnouncementsPanel
        scope={{ eventId }}
        canManage={false}
        title="Event notices"
      />
      <DocumentsPanel
        scope={{ eventId }}
        canManage={false}
        title="Event documents"
      />
      <MediaPanel
        scope={{ eventId }}
        title="Event media"
        description="Post-race coverage and approved imagery."
        canManage={Boolean(data.myRole)}
        allowOrganizerOnly={Boolean(data.myRole)}
      />
      <PaddockChat eventId={eventId} />
    </div>
  );
}

/** Public running order, grouped by day for multi-day meetings. */
function RunningOrder({ eventId }: { eventId: string }) {
  const sessions = api.session.forEvent.useQuery({ eventId });
  const rows = sessions.data ?? [];
  if (rows.length === 0) return null;
  const days = groupSessionsByDay(rows);

  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold">Running order</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {days.map((day) => (
          <Card key={day.dayKey}>
            <CardHeader>
              <CardTitle>
                {day.date.toLocaleDateString(undefined, {
                  weekday: "long",
                  month: "short",
                  day: "numeric",
                })}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {day.sessions.map((session) => (
                <div
                  key={session.id}
                  className="flex items-baseline justify-between gap-2 text-sm"
                >
                  <div>
                    <p className="font-medium">{session.name}</p>
                    <p className="text-xs text-brand-black/60">
                      {SESSION_TYPE_LABELS[session.type]}
                      {session.location ? ` · ${session.location}` : ""}
                    </p>
                  </div>
                  <span className="shrink-0 tabular-nums text-brand-black/70">
                    {new Date(session.startsAt).toLocaleTimeString(undefined, {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}

type EventData = inferRouterOutputs<AppRouter>["event"]["byId"];

function RegistrationPanel({
  event,
  onChanged,
}: {
  event: EventData;
  onChanged: () => void;
}) {
  const teams = api.team.myManagedTeams.useQuery();
  const [teamId, setTeamId] = useState("");
  const [carNumber, setCarNumber] = useState("");
  const [carClass, setCarClass] = useState("");

  const register = api.event.register.useMutation({ onSuccess: onChanged });
  const withdraw = api.event.withdrawRegistration.useMutation({
    onSuccess: onChanged,
  });

  const open = event.registrationState === "open";
  const active =
    event.myRegistration && event.myRegistration.status !== "WITHDRAWN";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Entry</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-brand-black/70">
          {event.confirmedCount} confirmed
          {event.entryCapacity ? ` of ${event.entryCapacity} slots` : ""}
        </p>

        {active ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-sm">Your entry:</span>
              <Badge
                variant={
                  event.myRegistration!.status === "CONFIRMED"
                    ? "verified"
                    : "default"
                }
              >
                {REGISTRATION_STATUS_LABELS[event.myRegistration!.status]}
              </Badge>
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={withdraw.isPending}
              onClick={() =>
                withdraw.mutate({ registrationId: event.myRegistration!.id })
              }
            >
              Withdraw entry
            </Button>
            {withdraw.error && (
              <p className="text-xs text-brand-red">
                {withdraw.error.message}
              </p>
            )}
          </div>
        ) : !open ? (
          <p className="text-sm text-brand-black/60">
            {WINDOW_MESSAGES[event.registrationState] ??
              "Registration is not open."}
          </p>
        ) : (
          <div className="space-y-3">
            <label className="block text-sm font-medium">
              Enter as
              <select
                className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
                value={teamId}
                onChange={(e) => setTeamId(e.target.value)}
              >
                <option value="">Myself</option>
                {teams.data?.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm font-medium">
                Car number
                <input
                  className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
                  value={carNumber}
                  onChange={(e) => setCarNumber(e.target.value)}
                  placeholder="24"
                />
              </label>
              <label className="block text-sm font-medium">
                Class
                <input
                  className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
                  value={carClass}
                  onChange={(e) => setCarClass(e.target.value)}
                  placeholder="GT3"
                />
              </label>
            </div>
            {register.error && (
              <p className="text-xs text-brand-red">{register.error.message}</p>
            )}
            <Button
              variant="primary"
              disabled={register.isPending}
              onClick={() =>
                register.mutate({
                  eventId: event.id,
                  teamId: teamId || undefined,
                  carNumber: carNumber.trim() || undefined,
                  carClass: carClass.trim() || undefined,
                })
              }
            >
              {register.isPending ? "Submitting…" : "Request entry"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function VolunteerPanel({
  event,
  onChanged,
}: {
  event: EventData;
  onChanged: () => void;
}) {
  const signUp = api.event.volunteerSignUp.useMutation({ onSuccess: onChanged });
  const cancel = api.event.volunteerCancel.useMutation({ onSuccess: onChanged });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Volunteer shifts</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {event.volunteerShifts.length === 0 && (
          <p className="text-sm text-brand-black/60">
            No volunteer shifts posted for this event.
          </p>
        )}
        {event.volunteerShifts.map((shift) => {
          const coverage = shiftCoverage(shift.capacity, shift.signups);
          const mine = event.myUserId
            ? shift.signups.find((s) => s.userId === event.myUserId)
            : undefined;
          return (
            <div
              key={shift.id}
              className="rounded-lg border border-brand-black/10 p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">{shift.title}</p>
                  <p className="text-xs text-brand-black/60">
                    {VOLUNTEER_ROLE_LABELS[shift.role]} ·{" "}
                    {new Date(shift.startsAt).toLocaleString()} –{" "}
                    {new Date(shift.endsAt).toLocaleTimeString()}
                  </p>
                </div>
                <Badge variant={coverage.isFull ? "default" : "verified"}>
                  {coverage.filled}/{coverage.capacity}
                  {coverage.waitlisted > 0
                    ? ` (+${coverage.waitlisted} waiting)`
                    : ""}
                </Badge>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant={coverage.isFull ? "outline" : "primary"}
                  disabled={signUp.isPending}
                  onClick={() => signUp.mutate({ shiftId: shift.id })}
                >
                  {coverage.isFull ? "Join waitlist" : "Sign up"}
                </Button>
                {mine && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={cancel.isPending}
                    onClick={() => cancel.mutate({ shiftId: shift.id })}
                  >
                    Cancel
                  </Button>
                )}
              </div>
            </div>
          );
        })}
        {(signUp.error || cancel.error) && (
          <p className="text-xs text-brand-red">
            {signUp.error?.message ?? cancel.error?.message}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
