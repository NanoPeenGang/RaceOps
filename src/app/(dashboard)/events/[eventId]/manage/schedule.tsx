"use client";

import { useState } from "react";
import { SessionType } from "@prisma/client";
import { api } from "@/lib/trpc/client";
import {
  SESSION_TYPE_LABELS,
  findScheduleClashes,
  groupSessionsByDay,
  scheduleSpan,
} from "@/lib/schedule";
import { SESSION_STATUS_LABELS } from "@/lib/timing";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ListSkeleton } from "@/components/ui/skeleton";

const dayLabel = (date: Date) =>
  date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });

const timeLabel = (date: Date) =>
  date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

/**
 * Running order for a meeting. Real-world events span several days, so
 * sessions are grouped by day and overlaps are surfaced as a warning rather
 * than blocked — support paddocks legitimately run things in parallel.
 */
export function SchedulePanel({ eventId }: { eventId: string }) {
  const utils = api.useUtils();
  const sessions = api.session.forEvent.useQuery({ eventId });
  const [showForm, setShowForm] = useState(false);

  const invalidate = () => {
    utils.session.forEvent.invalidate({ eventId });
    utils.event.byId.invalidate({ eventId });
  };

  const createSession = api.session.create.useMutation({
    meta: { silenceError: true },
    onSuccess: () => {
      setShowForm(false);
      setName("");
      invalidate();
    },
  });
  const deleteSession = api.session.delete.useMutation({
    onSuccess: invalidate,
  });

  const [type, setType] = useState<SessionType>(SessionType.PRACTICE);
  const [name, setName] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [location, setLocation] = useState("");

  const rows = sessions.data ?? [];
  const days = groupSessionsByDay(rows);
  const clashes = findScheduleClashes(rows);
  const span = scheduleSpan(rows);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-xl font-semibold">Running order</h2>
          {span && (
            <p className="text-sm text-brand-black/60">
              {span.days} day{span.days === 1 ? "" : "s"} · {rows.length}{" "}
              session{rows.length === 1 ? "" : "s"}
            </p>
          )}
        </div>
        <Button
          size="sm"
          variant="primary"
          onClick={() => setShowForm((v) => !v)}
        >
          {showForm ? "Cancel" : "Add session"}
        </Button>
      </div>

      {clashes.length > 0 && (
        <Card className="border-brand-red/40 bg-brand-red/5">
          <CardContent className="space-y-1 p-4 text-sm">
            <p className="font-medium text-brand-red">
              {clashes.length} overlapping session
              {clashes.length === 1 ? "" : "s"}
            </p>
            <ul className="list-inside list-disc text-brand-black/70">
              {clashes.map(([a, b]) => (
                <li key={`${a.id}-${b.id}`}>
                  {a.name} overlaps {b.name}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {showForm && (
        <Card className="max-w-2xl">
          <CardContent className="space-y-4 p-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm font-medium">
                Type
                <select
                  className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
                  value={type}
                  onChange={(e) => setType(e.target.value as SessionType)}
                >
                  {Object.values(SessionType).map((t) => (
                    <option key={t} value={t}>
                      {SESSION_TYPE_LABELS[t]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm font-medium">
                Name
                <input
                  className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Free Practice 2"
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
              <label className="block text-sm font-medium sm:col-span-2">
                Location <span className="text-brand-black/50">(optional)</span>
                <input
                  className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="Main circuit · Paddock briefing room"
                />
              </label>
            </div>
            {createSession.error && (
              <p className="text-sm text-brand-red">
                {createSession.error.message}
              </p>
            )}
            <Button
              variant="primary"
              disabled={
                createSession.isPending ||
                name.trim().length < 1 ||
                !startsAt ||
                !endsAt
              }
              onClick={() =>
                createSession.mutate({
                  eventId,
                  type,
                  name: name.trim(),
                  startsAt: new Date(startsAt),
                  endsAt: new Date(endsAt),
                  location: location.trim() || undefined,
                })
              }
            >
              {createSession.isPending ? "Adding…" : "Add session"}
            </Button>
          </CardContent>
        </Card>
      )}

      {sessions.isLoading && <ListSkeleton />}
      {rows.length === 0 && !sessions.isLoading && (
        <p className="text-brand-black/60">
          No sessions yet. Add scrutineering, practice, qualifying and the race
          to lay out the weekend.
        </p>
      )}

      <div className="space-y-5">
        {days.map((day) => (
          <div key={day.dayKey} className="space-y-2">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-brand-black/60">
              {dayLabel(day.date)}
            </h3>
            {day.sessions.map((session) => (
              <Card key={session.id}>
                <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div>
                    <p className="font-medium">{session.name}</p>
                    <p className="text-xs text-brand-black/60">
                      {SESSION_TYPE_LABELS[session.type]} ·{" "}
                      {timeLabel(session.startsAt)}–{timeLabel(session.endsAt)}
                      {session.location ? ` · ${session.location}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={
                        session.status === "LIVE" ? "verified" : "default"
                      }
                    >
                      {SESSION_STATUS_LABELS[session.status]}
                    </Badge>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={deleteSession.isPending}
                      onClick={() =>
                        deleteSession.mutate({ sessionId: session.id })
                      }
                    >
                      Delete
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ))}
      </div>
      {deleteSession.error && (
        <p className="text-sm text-brand-red">{deleteSession.error.message}</p>
      )}
    </section>
  );
}
