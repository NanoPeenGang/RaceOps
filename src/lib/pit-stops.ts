import { PitStopKind, PitStopStatus } from "@prisma/client";

/**
 * The stop plan for one entry at one event.
 *
 * A plan, not a log — but the same rows become the log, because the useful
 * comparison is "we said 32 seconds and it took 51". Keeping the intention and
 * the outcome apart in two tables would mean nobody ever lines them up.
 *
 * Everything here is pure. The planner runs it while a race is on, over a
 * phone connection in a pit box, so the arithmetic has to work with whatever
 * is already loaded rather than needing a round trip.
 */

export const PIT_STOP_KIND_LABELS: Record<PitStopKind, string> = {
  FUEL: "Fuel",
  TIRES: "Tires",
  DRIVER_CHANGE: "Driver change",
  REPAIR: "Repair",
  PENALTY_SERVE: "Serve penalty",
  OTHER: "Other",
};

export const PIT_STOP_STATUS_LABELS: Record<PitStopStatus, string> = {
  PLANNED: "Planned",
  COMPLETED: "Completed",
  SKIPPED: "Skipped",
};

export interface PitStopRecord {
  id: string;
  sequence: number;
  kind: PitStopKind;
  status: PitStopStatus;
  targetLap?: number | null;
  targetAt?: Date | string | null;
  driverInId?: string | null;
  driverOutId?: string | null;
  plannedSeconds?: number | null;
  actualAt?: Date | string | null;
  actualSeconds?: number | null;
}

export type PitStopProblemCode =
  | "NO_TARGET"
  | "DUPLICATE_SEQUENCE"
  | "OUT_OF_ORDER"
  | "DRIVER_IN_EQUALS_OUT"
  | "CHANGE_WITHOUT_DRIVER"
  | "COMPLETED_WITHOUT_TIME"
  | "HANDOVER_MISMATCH";

export interface PitStopProblem {
  code: PitStopProblemCode;
  message: string;
  /** The stop this is about, where it is about one. */
  stopId?: string;
  /**
   * A plan that is wrong now, versus one that is merely incomplete. A stop
   * with no target lap yet is normal at 9am on a Saturday; two stops numbered
   * 3 is wrong whenever you look at it.
   */
  severity: "error" | "warning";
}

/**
 * Everything wrong with a stop plan.
 *
 * Returns findings rather than throwing, for the same reason the line-up check
 * does: a plan is assembled over a morning and half-finished is the normal
 * state. The console shows these; nothing here blocks a save.
 */
export function checkPlan(stops: readonly PitStopRecord[]): PitStopProblem[] {
  const problems: PitStopProblem[] = [];
  const ordered = [...stops].sort((a, b) => a.sequence - b.sequence);

  const seenSequences = new Set<number>();
  for (const stop of ordered) {
    if (seenSequences.has(stop.sequence)) {
      problems.push({
        code: "DUPLICATE_SEQUENCE",
        message: `Two stops are numbered ${stop.sequence}.`,
        stopId: stop.id,
        severity: "error",
      });
    }
    seenSequences.add(stop.sequence);

    if (stop.targetLap == null && stop.targetAt == null) {
      problems.push({
        code: "NO_TARGET",
        message: `Stop ${stop.sequence} has no target lap or time.`,
        stopId: stop.id,
        severity: "warning",
      });
    }

    if (
      stop.driverInId &&
      stop.driverOutId &&
      stop.driverInId === stop.driverOutId
    ) {
      problems.push({
        code: "DRIVER_IN_EQUALS_OUT",
        message: `Stop ${stop.sequence} has the same driver getting in and out.`,
        stopId: stop.id,
        severity: "error",
      });
    }

    if (stop.kind === PitStopKind.DRIVER_CHANGE && !stop.driverInId) {
      problems.push({
        code: "CHANGE_WITHOUT_DRIVER",
        message: `Stop ${stop.sequence} is a driver change with nobody getting in.`,
        stopId: stop.id,
        severity: "warning",
      });
    }

    if (stop.status === PitStopStatus.COMPLETED && stop.actualAt == null) {
      problems.push({
        code: "COMPLETED_WITHOUT_TIME",
        message: `Stop ${stop.sequence} is marked complete but has no time.`,
        stopId: stop.id,
        severity: "warning",
      });
    }
  }

  // Targets should march forward. A stop planned for an earlier lap than the
  // one before it is nearly always a typo, and it silently breaks every fuel
  // calculation downstream of it.
  let previousLap: number | null = null;
  for (const stop of ordered) {
    if (stop.targetLap == null) continue;
    if (previousLap !== null && stop.targetLap <= previousLap) {
      problems.push({
        code: "OUT_OF_ORDER",
        message: `Stop ${stop.sequence} is planned for lap ${stop.targetLap}, which is not after the stop before it.`,
        stopId: stop.id,
        severity: "error",
      });
    }
    previousLap = stop.targetLap;
  }

  problems.push(...handoverProblems(ordered));
  return problems;
}

/**
 * Whether the driver changes join up.
 *
 * A stop that takes driver B out must follow the stop that put B in. Getting
 * this wrong produces a plan that looks fine stop-by-stop and cannot be driven
 * — and it is exactly the error a tired crew chief makes reshuffling a
 * rotation at midnight.
 */
function handoverProblems(ordered: readonly PitStopRecord[]): PitStopProblem[] {
  const problems: PitStopProblem[] = [];
  let inCar: string | null = null;

  for (const stop of ordered) {
    if (stop.status === PitStopStatus.SKIPPED) continue;
    if (!stop.driverInId && !stop.driverOutId) continue;

    if (stop.driverOutId && inCar !== null && stop.driverOutId !== inCar) {
      problems.push({
        code: "HANDOVER_MISMATCH",
        message: `Stop ${stop.sequence} takes out a driver who was not in the car.`,
        stopId: stop.id,
        severity: "error",
      });
    }
    if (stop.driverInId) inCar = stop.driverInId;
  }
  return problems;
}

/** The next stop number to hand a new row. */
export function nextSequence(stops: readonly { sequence: number }[]): number {
  return stops.reduce((max, stop) => Math.max(max, stop.sequence), 0) + 1;
}

/**
 * The stop a pit board should be counting down to.
 *
 * The lowest-numbered stop still planned. Skipped stops are passed over and
 * completed ones are behind us; when everything is done this is null, which is
 * the console's cue to say the plan is finished rather than to show stop 1
 * again.
 */
export function nextStop<T extends PitStopRecord>(
  stops: readonly T[],
): T | null {
  return (
    [...stops]
      .filter((stop) => stop.status === PitStopStatus.PLANNED)
      .sort((a, b) => a.sequence - b.sequence)[0] ?? null
  );
}

export interface StopTiming {
  completed: number;
  /** Mean stationary time across completed stops with a time, in seconds. */
  averageSeconds: number | null;
  bestSeconds: number | null;
  /**
   * Seconds lost against plan across all completed stops. Positive is slow.
   * Null when no completed stop has both a plan and an actual to compare.
   */
  deltaToPlanSeconds: number | null;
}

/**
 * How the stops are actually going.
 *
 * Only stops with a real number contribute. A completed stop nobody timed is
 * counted in `completed` but left out of the averages — including it as zero
 * would make a crew look quicker the less carefully they measured.
 */
export function stopTiming(stops: readonly PitStopRecord[]): StopTiming {
  const completed = stops.filter(
    (stop) => stop.status === PitStopStatus.COMPLETED,
  );
  const timed = completed.filter(
    (stop) => stop.actualSeconds != null && stop.actualSeconds > 0,
  );

  const seconds = timed.map((stop) => stop.actualSeconds!);
  const comparable = timed.filter(
    (stop) => stop.plannedSeconds != null && stop.plannedSeconds > 0,
  );

  return {
    completed: completed.length,
    averageSeconds: seconds.length
      ? seconds.reduce((sum, value) => sum + value, 0) / seconds.length
      : null,
    bestSeconds: seconds.length ? Math.min(...seconds) : null,
    deltaToPlanSeconds: comparable.length
      ? comparable.reduce(
          (sum, stop) => sum + (stop.actualSeconds! - stop.plannedSeconds!),
          0,
        )
      : null,
  };
}

/** "32s", "1m 04s" — stationary time as a crew says it. */
export function formatStopSeconds(
  seconds: number | null | undefined,
): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return null;
  const whole = Math.round(seconds);
  if (whole < 60) return `${whole}s`;
  return `${Math.floor(whole / 60)}m ${String(whole % 60).padStart(2, "0")}s`;
}
