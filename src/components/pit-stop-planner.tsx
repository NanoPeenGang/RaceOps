"use client";

import { useState } from "react";
import { PitStopKind, PitStopStatus } from "@prisma/client";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/trpc/root";
import { api } from "@/lib/trpc/client";
import {
  PIT_STOP_KIND_LABELS,
  PIT_STOP_STATUS_LABELS,
  formatStopSeconds,
} from "@/lib/pit-stops";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/**
 * The stop plan for one entry.
 *
 * Built to be used while a race is running, on a phone, in a pit box: the next
 * stop is at the top and large, marking one done is a single tap, and the
 * problems the plan has are stated in words rather than left for somebody to
 * spot at lap 84.
 *
 * The server decides who may write, so this only decides what to show.
 */

type PitPlan = inferRouterOutputs<AppRouter>["pitStop"]["forEntry"];
type PitStop = PitPlan["stops"][number];

export function PitStopPlanner({
  registrationId,
  title = "Pit stops",
}: {
  registrationId: string;
  title?: string;
}) {
  const utils = api.useUtils();
  const plan = api.pitStop.forEntry.useQuery(
    { registrationId },
    // Polled: two people in the same pit box editing the same plan is the
    // normal case, not the exception.
    { refetchInterval: 20_000, retry: false },
  );
  const lineup = api.lineup.forRegistration.useQuery(
    { registrationId },
    { retry: false },
  );
  const [adding, setAdding] = useState(false);

  const refresh = () => utils.pitStop.forEntry.invalidate({ registrationId });

  if (plan.error) {
    return (
      <section className="space-y-2">
        <h3 className="font-semibold">{title}</h3>
        <p className="text-sm text-brand-black/60">{plan.error.message}</p>
      </section>
    );
  }

  const stops = plan.data?.stops ?? [];
  const canWrite = plan.data?.canWrite ?? false;
  const problems = plan.data?.problems ?? [];
  const timing = plan.data?.timing;
  const next = plan.data?.next ?? null;

  const drivers = (lineup.data?.lineup ?? []).map((entry) => ({
    id: entry.id,
    name: entry.user.profile?.displayName ?? "Unnamed",
  }));

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">{title}</h3>
        {canWrite && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setAdding((open) => !open)}
          >
            {adding ? "Cancel" : "Add a stop"}
          </Button>
        )}
      </div>

      {next && (
        <Card className="border-brand-red/40 bg-brand-red/[0.03]">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-brand-black/50">
                Next stop
              </p>
              <p className="text-lg font-semibold">
                #{next.sequence} · {PIT_STOP_KIND_LABELS[next.kind]}
              </p>
              <p className="text-sm text-brand-black/70">
                {[
                  next.targetLap != null && `lap ${next.targetLap}`,
                  next.targetAt &&
                    new Date(next.targetAt).toLocaleTimeString(undefined, {
                      hour: "2-digit",
                      minute: "2-digit",
                    }),
                  next.driverIn &&
                    `${next.driverIn.user.profile?.displayName ?? "Unnamed"} in`,
                  next.plannedSeconds != null &&
                    `target ${formatStopSeconds(next.plannedSeconds)}`,
                ]
                  .filter(Boolean)
                  .join(" · ") || "No target set"}
              </p>
            </div>
            {canWrite && <CompleteButton stopId={next.id} onDone={refresh} />}
          </CardContent>
        </Card>
      )}

      {problems.length > 0 && (
        <ul className="space-y-1 rounded-lg border border-amber-500/40 bg-amber-50/60 p-3 text-sm">
          {problems.map((problem, index) => (
            <li
              key={`${problem.code}-${problem.stopId ?? index}`}
              className={
                problem.severity === "error"
                  ? "text-brand-red"
                  : "text-amber-700"
              }
            >
              {problem.message}
            </li>
          ))}
        </ul>
      )}

      {adding && (
        <StopForm
          registrationId={registrationId}
          drivers={drivers}
          onSaved={() => {
            setAdding(false);
            refresh();
          }}
        />
      )}

      {plan.isLoading && (
        <p className="text-sm text-brand-black/60">Loading plan…</p>
      )}

      {!plan.isLoading && stops.length === 0 && !adding && (
        <p className="rounded-lg border border-dashed border-brand-black/20 p-5 text-center text-sm text-brand-black/55">
          No stops planned. Even two rows — when you are coming in and who is
          getting in — beats deciding it on the radio.
        </p>
      )}

      {stops.length > 0 && (
        <div className="space-y-2">
          {stops.map((stop) => (
            <StopRow
              key={stop.id}
              stop={stop}
              canWrite={canWrite}
              onChanged={refresh}
            />
          ))}
        </div>
      )}

      {timing && timing.completed > 0 && (
        <p className="flex flex-wrap gap-x-4 text-xs text-brand-black/55">
          <span>{timing.completed} completed</span>
          {timing.averageSeconds != null && (
            <span>
              average {formatStopSeconds(timing.averageSeconds)}
            </span>
          )}
          {timing.bestSeconds != null && (
            <span>best {formatStopSeconds(timing.bestSeconds)}</span>
          )}
          {timing.deltaToPlanSeconds != null && (
            <span>
              {timing.deltaToPlanSeconds >= 0 ? "+" : ""}
              {Math.round(timing.deltaToPlanSeconds)}s against plan
            </span>
          )}
        </p>
      )}
    </section>
  );
}

const STATUS_VARIANT: Record<PitStopStatus, "default" | "verified" | "outline"> =
  {
    PLANNED: "outline",
    COMPLETED: "verified",
    SKIPPED: "default",
  };

function StopRow({
  stop,
  canWrite,
  onChanged,
}: {
  stop: PitStop;
  canWrite: boolean;
  onChanged: () => void;
}) {
  const update = api.pitStop.update.useMutation({ onSuccess: onChanged });
  const remove = api.pitStop.remove.useMutation({ onSuccess: onChanged });

  return (
    <Card>
      <CardContent className="space-y-1 p-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm font-medium">
            #{stop.sequence} · {PIT_STOP_KIND_LABELS[stop.kind]}
            {stop.targetLap != null && (
              <span className="ml-2 font-normal text-brand-black/60">
                lap {stop.targetLap}
              </span>
            )}
          </p>
          <Badge variant={STATUS_VARIANT[stop.status]}>
            {PIT_STOP_STATUS_LABELS[stop.status]}
          </Badge>
        </div>

        <p className="text-xs text-brand-black/60">
          {[
            stop.driverOut &&
              `${stop.driverOut.user.profile?.displayName ?? "Unnamed"} out`,
            stop.driverIn &&
              `${stop.driverIn.user.profile?.displayName ?? "Unnamed"} in`,
            stop.fuelLitres != null && `${stop.fuelLitres} L`,
            stop.tireSet && `set ${stop.tireSet.identifier}`,
            stop.plannedSeconds != null &&
              `target ${formatStopSeconds(stop.plannedSeconds)}`,
            stop.actualSeconds != null &&
              `took ${formatStopSeconds(stop.actualSeconds)}`,
          ]
            .filter(Boolean)
            .join(" · ") || "Nothing specified yet"}
        </p>

        {stop.notes && (
          <p className="text-xs text-brand-black/70">{stop.notes}</p>
        )}

        {canWrite && (
          <p className="flex flex-wrap gap-x-3 pt-1 text-xs text-brand-black/50">
            {stop.status === PitStopStatus.PLANNED && (
              <>
                <CompleteButton stopId={stop.id} onDone={onChanged} inline />
                <button
                  type="button"
                  className="hover:text-brand-black"
                  disabled={update.isPending}
                  onClick={() =>
                    update.mutate({
                      stopId: stop.id,
                      status: PitStopStatus.SKIPPED,
                    })
                  }
                >
                  Skip
                </button>
                <button
                  type="button"
                  className="hover:text-brand-red"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate({ stopId: stop.id })}
                >
                  Remove
                </button>
              </>
            )}
            {stop.status !== PitStopStatus.PLANNED && (
              <button
                type="button"
                className="hover:text-brand-black"
                disabled={update.isPending}
                onClick={() =>
                  update.mutate({
                    stopId: stop.id,
                    status: PitStopStatus.PLANNED,
                  })
                }
              >
                Back to planned
              </button>
            )}
            {remove.error && (
              <span className="text-brand-red">{remove.error.message}</span>
            )}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Marking a stop done.
 *
 * The stationary time is optional and asked for after the fact: the moment the
 * car leaves, the useful action is one tap, and making somebody type a number
 * first is how stops stop being logged at all.
 */
function CompleteButton({
  stopId,
  onDone,
  inline = false,
}: {
  stopId: string;
  onDone: () => void;
  inline?: boolean;
}) {
  const [seconds, setSeconds] = useState("");
  const complete = api.pitStop.complete.useMutation({
    onSuccess: () => {
      setSeconds("");
      onDone();
    },
  });

  const submit = () =>
    complete.mutate({
      stopId,
      actualSeconds: seconds.trim() ? Number(seconds) : null,
    });

  if (inline) {
    return (
      <button
        type="button"
        className="hover:text-brand-black"
        disabled={complete.isPending}
        onClick={submit}
      >
        Mark done
      </button>
    );
  }

  return (
    <span className="flex items-center gap-2">
      <input
        type="number"
        min={0}
        className="w-20 rounded-md border border-brand-black/20 px-2 py-1 text-sm"
        value={seconds}
        onChange={(event) => setSeconds(event.target.value)}
        placeholder="secs"
        aria-label="Stationary time in seconds"
      />
      <Button
        size="sm"
        variant="primary"
        disabled={complete.isPending}
        onClick={submit}
      >
        Done
      </Button>
    </span>
  );
}

function StopForm({
  registrationId,
  drivers,
  onSaved,
}: {
  registrationId: string;
  drivers: { id: string; name: string }[];
  onSaved: () => void;
}) {
  const [kind, setKind] = useState<PitStopKind>(PitStopKind.FUEL);
  const [targetLap, setTargetLap] = useState("");
  const [driverInId, setDriverInId] = useState("");
  const [driverOutId, setDriverOutId] = useState("");
  const [fuelLitres, setFuelLitres] = useState("");
  const [plannedSeconds, setPlannedSeconds] = useState("");
  const [notes, setNotes] = useState("");

  const add = api.pitStop.add.useMutation({ onSuccess: onSaved });

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="grid gap-3 sm:grid-cols-4">
          <label className="block text-sm font-medium">
            Kind
            <select
              className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
              value={kind}
              onChange={(event) => setKind(event.target.value as PitStopKind)}
            >
              {Object.values(PitStopKind).map((option) => (
                <option key={option} value={option}>
                  {PIT_STOP_KIND_LABELS[option]}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-medium">
            Target lap
            <input
              type="number"
              min={1}
              className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
              value={targetLap}
              onChange={(event) => setTargetLap(event.target.value)}
            />
          </label>
          <label className="block text-sm font-medium">
            Fuel (L)
            <input
              type="number"
              min={0}
              step="0.5"
              className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
              value={fuelLitres}
              onChange={(event) => setFuelLitres(event.target.value)}
            />
          </label>
          <label className="block text-sm font-medium">
            Target time (s)
            <input
              type="number"
              min={0}
              className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
              value={plannedSeconds}
              onChange={(event) => setPlannedSeconds(event.target.value)}
            />
          </label>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm font-medium">
            Driver out
            <select
              className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
              value={driverOutId}
              onChange={(event) => setDriverOutId(event.target.value)}
            >
              <option value="">—</option>
              {drivers.map((driver) => (
                <option key={driver.id} value={driver.id}>
                  {driver.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-medium">
            Driver in
            <select
              className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
              value={driverInId}
              onChange={(event) => setDriverInId(event.target.value)}
            >
              <option value="">—</option>
              {drivers.map((driver) => (
                <option key={driver.id} value={driver.id}>
                  {driver.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="block text-sm font-medium">
          Notes
          <input
            className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Splash only if the safety car is out."
          />
        </label>

        {add.error && (
          <p className="text-sm text-brand-red">{add.error.message}</p>
        )}
        <Button
          size="sm"
          variant="primary"
          disabled={add.isPending}
          onClick={() =>
            add.mutate({
              registrationId,
              kind,
              targetLap: targetLap.trim() ? Number(targetLap) : null,
              driverInId: driverInId || null,
              driverOutId: driverOutId || null,
              fuelLitres: fuelLitres.trim() ? Number(fuelLitres) : null,
              plannedSeconds: plannedSeconds.trim()
                ? Number(plannedSeconds)
                : null,
              notes: notes.trim() || null,
            })
          }
        >
          {add.isPending ? "Adding…" : "Add stop"}
        </Button>
      </CardContent>
    </Card>
  );
}
