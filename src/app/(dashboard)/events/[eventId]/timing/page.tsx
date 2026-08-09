"use client";

import { use, useState } from "react";
import Link from "next/link";
import { SessionStatus } from "@prisma/client";
import { api } from "@/lib/trpc/client";
import { SESSION_TYPE_LABELS } from "@/lib/schedule";
import {
  FLAG_LABELS,
  FLAG_STYLES,
  SESSION_STATUS_LABELS,
  TIMING_STATUS_LABELS,
  fastestLapOf,
  formatGap,
  formatLapTime,
  lapsDown,
  sortTimingRows,
} from "@/lib/timing";
import { describeConditions } from "@/lib/conditions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ListSkeleton } from "@/components/ui/skeleton";

/** Public live timing board. Polls while a session is running. */
export default function TimingPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = use(params);
  const event = api.event.byId.useQuery({ eventId });
  const sessions = api.session.forEvent.useQuery({ eventId });
  const [sessionId, setSessionId] = useState<string | null>(null);

  const active =
    sessions.data?.find((s) => s.id === sessionId) ??
    sessions.data?.find((s) => s.status === SessionStatus.LIVE) ??
    [...(sessions.data ?? [])]
      .reverse()
      .find((s) => s.status === SessionStatus.FINISHED) ??
    sessions.data?.[0];

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/events/${eventId}`}
          className="text-sm text-brand-red hover:underline"
        >
          ← {event.data?.name ?? "Event"}
        </Link>
        <h1 className="mt-1 text-3xl font-bold">Live timing</h1>
      </div>

      {sessions.isLoading && <ListSkeleton />}
      {sessions.data?.length === 0 && (
        <p className="text-brand-black/60">
          No sessions have been scheduled for this event yet.
        </p>
      )}

      {sessions.data && sessions.data.length > 0 && (
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {sessions.data.map((session) => (
            <Button
              key={session.id}
              size="sm"
              variant={session.id === active?.id ? "primary" : "outline"}
              className="shrink-0"
              onClick={() => setSessionId(session.id)}
            >
              {session.name}
              {session.status === SessionStatus.LIVE ? " ●" : ""}
            </Button>
          ))}
        </div>
      )}

      {active && <TimingBoard key={active.id} sessionId={active.id} />}
    </div>
  );
}

function TimingBoard({ sessionId }: { sessionId: string }) {
  const board = api.session.timing.useQuery(
    { sessionId },
    {
      // Only hammer the endpoint while the session is actually running.
      refetchInterval: (query) =>
        query.state.data?.session.status === SessionStatus.LIVE ? 5000 : false,
    },
  );

  if (board.isLoading) return <ListSkeleton />;
  if (board.error)
    return <p className="text-sm text-brand-red">{board.error.message}</p>;

  const { session, entries, currentConditions, wet } = board.data!;
  const ordered = sortTimingRows(entries);
  const leader = ordered[0];
  const fastest = fastestLapOf(ordered);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-xl font-semibold">{session.name}</h2>
          <p className="text-sm text-brand-black/60">
            {SESSION_TYPE_LABELS[session.type]} ·{" "}
            {SESSION_STATUS_LABELS[session.status]} ·{" "}
            {new Date(session.startsAt).toLocaleString()}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {currentConditions && (
            <span className="rounded-md bg-brand-black/5 px-3 py-1 text-sm">
              {describeConditions({
                ...currentConditions,
                recordedAt: new Date(currentConditions.recordedAt),
              })}
              {wet ? " · wet session" : ""}
            </span>
          )}
          <span
            className={`rounded-md px-3 py-1 text-sm font-semibold ${FLAG_STYLES[session.flagState]}`}
          >
            {FLAG_LABELS[session.flagState]}
          </span>
        </div>
      </div>

      {ordered.length === 0 ? (
        <p className="text-brand-black/60">
          The timing board is empty — nothing has been posted for this session
          yet.
        </p>
      ) : (
        <>
          {/* Table on wide screens; stacked cards on a phone in the paddock. */}
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full text-sm">
              <thead className="border-b border-brand-black/10 text-left text-xs uppercase tracking-wide text-brand-black/60">
                <tr>
                  <th className="py-2 pr-3">Pos</th>
                  <th className="py-2 pr-3">No.</th>
                  <th className="py-2 pr-3">Competitor</th>
                  <th className="py-2 pr-3">Class</th>
                  <th className="py-2 pr-3 text-right">Laps</th>
                  <th className="py-2 pr-3 text-right">Gap</th>
                  <th className="py-2 pr-3 text-right">Last</th>
                  <th className="py-2 pr-3 text-right">Best</th>
                  <th className="py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {ordered.map((row, index) => (
                  <tr
                    key={row.id}
                    className="border-b border-brand-black/5 last:border-0"
                  >
                    <td className="py-2 pr-3 font-semibold">
                      {row.position ?? index + 1}
                    </td>
                    <td className="py-2 pr-3">
                      {row.registration.carNumber ?? "—"}
                    </td>
                    <td className="py-2 pr-3">{row.competitorLabel}</td>
                    <td className="py-2 pr-3 text-brand-black/60">
                      {row.registration.carClass ?? "—"}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {row.lapsCompleted}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {formatGap(row.gapMs, lapsDown(row, leader))}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {formatLapTime(row.lastLapMs)}
                    </td>
                    <td
                      className={`py-2 pr-3 text-right tabular-nums ${
                        fastest?.id === row.id
                          ? "font-semibold text-brand-red"
                          : ""
                      }`}
                    >
                      {formatLapTime(row.bestLapMs)}
                    </td>
                    <td className="py-2 text-brand-black/60">
                      {TIMING_STATUS_LABELS[row.status]}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-2 sm:hidden">
            {ordered.map((row, index) => (
              <Card key={row.id}>
                <CardContent className="flex items-center gap-3 p-3">
                  <span className="w-8 text-center text-lg font-bold">
                    {row.position ?? index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">
                      {row.registration.carNumber
                        ? `#${row.registration.carNumber} `
                        : ""}
                      {row.competitorLabel}
                    </p>
                    <p className="text-xs text-brand-black/60">
                      {row.lapsCompleted} laps ·{" "}
                      {formatGap(row.gapMs, lapsDown(row, leader))} ·{" "}
                      {TIMING_STATUS_LABELS[row.status]}
                    </p>
                  </div>
                  <div className="text-right text-xs tabular-nums">
                    <p>{formatLapTime(row.lastLapMs)}</p>
                    <p
                      className={
                        fastest?.id === row.id
                          ? "font-semibold text-brand-red"
                          : "text-brand-black/60"
                      }
                    >
                      {formatLapTime(row.bestLapMs)}
                    </p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {fastest && (
            <p className="text-sm text-brand-black/60">
              Fastest lap:{" "}
              <Badge variant="verified">
                {formatLapTime(fastest.bestLapMs)}
              </Badge>{" "}
              {fastest.competitorLabel}
            </p>
          )}
        </>
      )}
    </div>
  );
}
