import { FlagState, SessionStatus, TimingStatus } from "@prisma/client";

/** Live timing formatting and ordering. Pure — shared by the board and tests. */

// Lap-time parsing/formatting is shared with the results importer.
export { formatLapTime, parseLapTime } from "@/lib/lap-time";

/** Gap to the leader: "+1.234", "+1 lap", or "—" for the leader. */
export function formatGap(
  gapMs: number | null | undefined,
  lapsDownCount = 0,
): string {
  if (lapsDownCount > 0) {
    return `+${lapsDownCount} lap${lapsDownCount === 1 ? "" : "s"}`;
  }
  if (gapMs === null || gapMs === undefined) return "—";
  if (gapMs <= 0) return "—";
  return `+${(gapMs / 1000).toFixed(3)}`;
}

export const FLAG_LABELS: Record<FlagState, string> = {
  NONE: "—",
  GREEN: "Green",
  YELLOW: "Yellow",
  SAFETY_CAR: "Safety car",
  VIRTUAL_SAFETY_CAR: "Virtual safety car",
  RED: "Red",
  CHECKERED: "Checkered",
};

/** Tailwind classes for the flag banner; red and yellow must read instantly. */
export const FLAG_STYLES: Record<FlagState, string> = {
  NONE: "bg-brand-black/10 text-brand-black",
  GREEN: "bg-green-600 text-white",
  YELLOW: "bg-yellow-400 text-brand-black",
  SAFETY_CAR: "bg-yellow-500 text-brand-black",
  VIRTUAL_SAFETY_CAR: "bg-yellow-300 text-brand-black",
  RED: "bg-brand-red text-white",
  CHECKERED: "bg-brand-black text-white",
};

export const TIMING_STATUS_LABELS: Record<TimingStatus, string> = {
  RUNNING: "Running",
  PIT: "In pit",
  OUT: "Out lap",
  STOPPED: "Stopped",
  FINISHED: "Finished",
  DNS: "DNS",
};

export const SESSION_STATUS_LABELS: Record<SessionStatus, string> = {
  SCHEDULED: "Scheduled",
  LIVE: "Live",
  FINISHED: "Finished",
  CANCELED: "Canceled",
};

export interface TimingRow {
  registrationId: string;
  position: number | null;
  lapsCompleted: number;
  bestLapMs: number | null;
  lastLapMs: number | null;
  gapMs: number | null;
  status: TimingStatus;
}

/**
 * Board order. An explicit position from the timing feed always wins; rows
 * without one fall back to laps completed, then best lap, so a partially
 * populated feed still renders sensibly.
 */
export function sortTimingRows<T extends TimingRow>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    if (a.position !== null && b.position !== null) {
      return a.position - b.position;
    }
    if (a.position !== null) return -1;
    if (b.position !== null) return 1;

    if (b.lapsCompleted !== a.lapsCompleted) {
      return b.lapsCompleted - a.lapsCompleted;
    }
    const aBest = a.bestLapMs ?? Number.MAX_SAFE_INTEGER;
    const bBest = b.bestLapMs ?? Number.MAX_SAFE_INTEGER;
    return aBest - bBest;
  });
}

/** Laps a row is behind the leader (0 when on the lead lap). */
export function lapsDown(row: TimingRow, leader: TimingRow | undefined): number {
  if (!leader) return 0;
  return Math.max(0, leader.lapsCompleted - row.lapsCompleted);
}

/** The fastest lap in the session, or null if nobody has set one. */
export function fastestLapOf<T extends TimingRow>(rows: T[]): T | null {
  let fastest: T | null = null;
  for (const row of rows) {
    if (row.bestLapMs === null) continue;
    if (fastest === null || row.bestLapMs < fastest.bestLapMs!) {
      fastest = row;
    }
  }
  return fastest;
}
