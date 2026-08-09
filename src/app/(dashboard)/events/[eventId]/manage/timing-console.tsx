"use client";

import { useState } from "react";
import {
  FlagState,
  SessionStatus,
  TimingStatus,
  TrackState,
  WeatherKind,
} from "@prisma/client";
import { api } from "@/lib/trpc/client";
import { SESSION_TYPE_LABELS } from "@/lib/schedule";
import {
  TRACK_STATE_LABELS,
  WEATHER_LABELS,
  currentConditions,
  describeConditions,
  sessionWasWet,
} from "@/lib/conditions";
import {
  FLAG_LABELS,
  FLAG_STYLES,
  SESSION_STATUS_LABELS,
  TIMING_STATUS_LABELS,
  formatLapTime,
  lapsDown,
  sortTimingRows,
} from "@/lib/timing";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Race-control console: pick a session, run the flags, and push timing rows.
 *
 * Timing is entered per row rather than as a bulk feed — the point is that a
 * small club meeting with one laptop can run a live board, and a series with a
 * real timing system can post to the same endpoints.
 */
export function TimingConsole({ eventId }: { eventId: string }) {
  const sessions = api.session.forEvent.useQuery({ eventId });
  const [sessionId, setSessionId] = useState<string | null>(null);

  const active =
    sessions.data?.find((s) => s.id === sessionId) ??
    sessions.data?.find((s) => s.status === SessionStatus.LIVE) ??
    sessions.data?.[0];

  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold">Live timing control</h2>

      {sessions.isLoading && <p className="text-brand-black/60">Loading…</p>}
      {sessions.data?.length === 0 && (
        <p className="text-brand-black/60">
          Add sessions to the running order first — timing hangs off a session.
        </p>
      )}

      {sessions.data && sessions.data.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {sessions.data.map((session) => (
            <Button
              key={session.id}
              size="sm"
              variant={session.id === active?.id ? "primary" : "outline"}
              onClick={() => setSessionId(session.id)}
            >
              {session.name}
            </Button>
          ))}
        </div>
      )}

      {active && <SessionConsole key={active.id} sessionId={active.id} />}
    </section>
  );
}

function SessionConsole({ sessionId }: { sessionId: string }) {
  const utils = api.useUtils();
  const board = api.session.timing.useQuery(
    { sessionId },
    // Officials need a shared view; polling keeps two consoles in step even
    // without a realtime service configured.
    { refetchInterval: 5000 },
  );
  const invalidate = () => utils.session.timing.invalidate({ sessionId });

  const setLiveState = api.session.setLiveState.useMutation({
    meta: { silenceError: true },
    onSuccess: () => {
      invalidate();
      utils.session.forEvent.invalidate();
      utils.session.liveNow.invalidate();
    },
  });
  const seedTiming = api.session.seedTiming.useMutation({
    meta: { successMessage: "Timing seeded from the entry list." },
    onSuccess: invalidate,
  });
  const pushTiming = api.session.pushTiming.useMutation({
    meta: { successMessage: "Timing pushed." },
    onSuccess: invalidate,
  });

  if (board.isLoading) return <p className="text-brand-black/60">Loading…</p>;
  if (board.error)
    return <p className="text-sm text-brand-red">{board.error.message}</p>;

  const { session, entries } = board.data!;
  const ordered = sortTimingRows(entries);
  const leader = ordered[0];

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-medium">{session.name}</p>
              <p className="text-xs text-brand-black/60">
                {SESSION_TYPE_LABELS[session.type]} ·{" "}
                {SESSION_STATUS_LABELS[session.status]}
              </p>
            </div>
            <span
              className={`rounded-md px-3 py-1 text-sm font-semibold ${FLAG_STYLES[session.flagState]}`}
            >
              {FLAG_LABELS[session.flagState]}
            </span>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-brand-black/60">
              Session
            </p>
            <div className="flex flex-wrap gap-2">
              {Object.values(SessionStatus).map((status) => (
                <Button
                  key={status}
                  size="sm"
                  variant={status === session.status ? "primary" : "outline"}
                  disabled={setLiveState.isPending}
                  onClick={() => setLiveState.mutate({ sessionId, status })}
                >
                  {SESSION_STATUS_LABELS[status]}
                </Button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-brand-black/60">
              Flag
            </p>
            <div className="flex flex-wrap gap-2">
              {Object.values(FlagState).map((flag) => (
                <Button
                  key={flag}
                  size="sm"
                  variant={flag === session.flagState ? "primary" : "outline"}
                  disabled={setLiveState.isPending}
                  onClick={() =>
                    setLiveState.mutate({ sessionId, flagState: flag })
                  }
                >
                  {FLAG_LABELS[flag]}
                </Button>
              ))}
            </div>
          </div>

          {setLiveState.error && (
            <p className="text-sm text-brand-red">
              {setLiveState.error.message}
            </p>
          )}
        </CardContent>
      </Card>

      <ConditionsCard
        sessionId={sessionId}
        readings={board.data!.conditions}
        onChanged={invalidate}
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-brand-black/60">
          {ordered.length} row{ordered.length === 1 ? "" : "s"} on the board
        </p>
        <Button
          size="sm"
          variant="outline"
          disabled={seedTiming.isPending}
          onClick={() => seedTiming.mutate({ sessionId })}
        >
          {seedTiming.isPending ? "Adding…" : "Add confirmed entries"}
        </Button>
      </div>
      {seedTiming.error && (
        <p className="text-sm text-brand-red">{seedTiming.error.message}</p>
      )}

      {ordered.length === 0 ? (
        <p className="text-brand-black/60">
          The board is empty. &ldquo;Add confirmed entries&rdquo; seeds a row
          per entry so you can fill in positions and lap times.
        </p>
      ) : (
        <div className="space-y-2">
          {ordered.map((row) => (
            <TimingRowEditor
              key={row.id}
              sessionId={sessionId}
              row={row}
              lapsBehind={lapsDown(row, leader)}
              isPending={pushTiming.isPending}
              onPush={(values) =>
                pushTiming.mutate({
                  sessionId,
                  registrationId: row.registrationId,
                  ...values,
                })
              }
            />
          ))}
        </div>
      )}
      {pushTiming.error && (
        <p className="text-sm text-brand-red">{pushTiming.error.message}</p>
      )}
    </div>
  );
}

interface RowValues {
  position?: number | null;
  lapsCompleted?: number;
  lastLap?: string | null;
  bestLap?: string | null;
  status?: TimingStatus;
}

function TimingRowEditor({
  row,
  lapsBehind,
  isPending,
  onPush,
}: {
  sessionId: string;
  row: {
    id: string;
    registrationId: string;
    position: number | null;
    lapsCompleted: number;
    lastLapMs: number | null;
    bestLapMs: number | null;
    status: TimingStatus;
    competitorLabel: string;
    registration: { carNumber: string | null; carClass: string | null };
  };
  lapsBehind: number;
  isPending: boolean;
  onPush: (values: RowValues) => void;
}) {
  const [position, setPosition] = useState(
    row.position === null ? "" : String(row.position),
  );
  const [laps, setLaps] = useState(String(row.lapsCompleted));
  const [lastLap, setLastLap] = useState(
    row.lastLapMs === null ? "" : formatLapTime(row.lastLapMs),
  );

  return (
    <Card>
      <CardContent className="grid gap-3 p-4 sm:grid-cols-[1fr_auto] sm:items-end">
        <div>
          <p className="font-medium">
            {row.registration.carNumber
              ? `#${row.registration.carNumber} `
              : ""}
            {row.competitorLabel}
          </p>
          <p className="text-xs text-brand-black/60">
            {[
              row.registration.carClass,
              TIMING_STATUS_LABELS[row.status],
              row.bestLapMs !== null && `Best ${formatLapTime(row.bestLapMs)}`,
              lapsBehind > 0 &&
                `${lapsBehind} lap${lapsBehind === 1 ? "" : "s"} down`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <label className="text-xs font-medium">
            Pos
            <input
              className="mt-1 w-full rounded-md border border-brand-black/20 px-2 py-1.5 text-sm"
              inputMode="numeric"
              value={position}
              onChange={(e) => setPosition(e.target.value)}
            />
          </label>
          <label className="text-xs font-medium">
            Laps
            <input
              className="mt-1 w-full rounded-md border border-brand-black/20 px-2 py-1.5 text-sm"
              inputMode="numeric"
              value={laps}
              onChange={(e) => setLaps(e.target.value)}
            />
          </label>
          <label className="text-xs font-medium">
            Last lap
            <input
              className="mt-1 w-full rounded-md border border-brand-black/20 px-2 py-1.5 text-sm"
              placeholder="1:23.456"
              value={lastLap}
              onChange={(e) => setLastLap(e.target.value)}
            />
          </label>
          <div className="flex items-end">
            <Button
              size="sm"
              variant="primary"
              disabled={isPending}
              onClick={() =>
                onPush({
                  position: position.trim() === "" ? null : Number(position),
                  lapsCompleted: Number(laps) || 0,
                  // The server lowers the best lap when this one is quicker,
                  // so officials only type one time per row.
                  lastLap: lastLap.trim() === "" ? null : lastLap.trim(),
                })
              }
            >
              Push
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Track and air conditions, logged as readings rather than edited in place.
 *
 * A two-hour race that starts dry and ends in standing water is the normal
 * case; overwriting the first reading with the second loses the fact anyone
 * reviewing strategy — or contesting a lap record — actually needs.
 */
function ConditionsCard({
  sessionId,
  readings,
  onChanged,
}: {
  sessionId: string;
  readings: {
    id: string;
    recordedAt: Date;
    trackState: TrackState;
    weather: WeatherKind | null;
    airTempC: number | null;
    trackTempC: number | null;
    humidityPct: number | null;
    windKph: number | null;
    windDirection: string | null;
    notes: string | null;
    recordedBy: { profile: { displayName: string } | null } | null;
  }[];
  onChanged: () => void;
}) {
  const [trackState, setTrackState] = useState<TrackState>(TrackState.DRY);
  const [weather, setWeather] = useState<WeatherKind | "">("");
  const [airTempC, setAirTempC] = useState("");
  const [trackTempC, setTrackTempC] = useState("");
  const [humidityPct, setHumidityPct] = useState("");
  const [notes, setNotes] = useState("");

  const log = api.session.logConditions.useMutation({
    meta: { successMessage: "Conditions logged." },
    onSuccess: () => {
      onChanged();
      setNotes("");
    },
  });
  const remove = api.session.deleteConditions.useMutation({
    onSuccess: onChanged,
  });

  const ordered = [...readings].map((reading) => ({
    ...reading,
    recordedAt: new Date(reading.recordedAt),
  }));
  const latest = currentConditions(ordered);
  const wet = sessionWasWet(ordered);

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-black/60">
            Conditions
          </p>
          {latest && (
            <p className="text-sm">
              {describeConditions(latest)}
              {wet && (
                <span className="ml-2 text-xs text-brand-black/60">
                  wet session — laps excluded from dry records
                </span>
              )}
            </p>
          )}
        </div>

        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block text-sm font-medium">
            Track
            <select
              className="mt-1 w-full rounded-md border border-brand-black/20 px-2 py-1.5 text-sm"
              value={trackState}
              onChange={(e) => setTrackState(e.target.value as TrackState)}
            >
              {Object.entries(TRACK_STATE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-medium">
            Weather
            <select
              className="mt-1 w-full rounded-md border border-brand-black/20 px-2 py-1.5 text-sm"
              value={weather}
              onChange={(e) => setWeather(e.target.value as WeatherKind | "")}
            >
              <option value="">Not recorded</option>
              {Object.entries(WEATHER_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-medium">
            Air °C
            <input
              inputMode="decimal"
              className="mt-1 w-full rounded-md border border-brand-black/20 px-2 py-1.5 text-sm"
              value={airTempC}
              onChange={(e) => setAirTempC(e.target.value)}
            />
          </label>
          <label className="block text-sm font-medium">
            Track °C
            <input
              inputMode="decimal"
              className="mt-1 w-full rounded-md border border-brand-black/20 px-2 py-1.5 text-sm"
              value={trackTempC}
              onChange={(e) => setTrackTempC(e.target.value)}
            />
          </label>
          <label className="block text-sm font-medium">
            Humidity %
            <input
              inputMode="numeric"
              className="mt-1 w-full rounded-md border border-brand-black/20 px-2 py-1.5 text-sm"
              value={humidityPct}
              onChange={(e) => setHumidityPct(e.target.value)}
            />
          </label>
          <label className="block text-sm font-medium sm:col-span-2 lg:col-span-3">
            Note
            <input
              className="mt-1 w-full rounded-md border border-brand-black/20 px-2 py-1.5 text-sm"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Rain arriving from turn 8"
            />
          </label>
        </div>

        {log.error && (
          <p className="text-sm text-brand-red">{log.error.message}</p>
        )}

        <Button
          size="sm"
          variant="primary"
          disabled={log.isPending}
          onClick={() =>
            log.mutate({
              sessionId,
              trackState,
              weather: weather || undefined,
              airTempC: airTempC.trim() ? Number(airTempC) : undefined,
              trackTempC: trackTempC.trim() ? Number(trackTempC) : undefined,
              humidityPct: humidityPct.trim() ? Number(humidityPct) : undefined,
              notes: notes.trim() || undefined,
            })
          }
        >
          {log.isPending ? "Logging…" : "Log reading"}
        </Button>

        {ordered.length > 0 && (
          <ul className="space-y-1 border-t border-brand-black/10 pt-3 text-sm">
            {[...ordered]
              .sort((a, b) => b.recordedAt.getTime() - a.recordedAt.getTime())
              .map((reading) => (
                <li
                  key={reading.id}
                  className="flex flex-wrap items-baseline justify-between gap-2"
                >
                  <span>
                    <span className="tabular-nums text-brand-black/60">
                      {reading.recordedAt.toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>{" "}
                    {describeConditions(reading)}
                    {reading.notes ? ` — ${reading.notes}` : ""}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate({ conditionId: reading.id })}
                  >
                    Remove
                  </Button>
                </li>
              ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
