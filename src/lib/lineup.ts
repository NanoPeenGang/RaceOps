import { LineupRole } from "@prisma/client";

/**
 * Endurance line-ups and drive-time regulations.
 *
 * Drive time is checked per driver across the whole event, not per stint: the
 * common regulations are "no more than 4 hours total" and "no single stint over
 * 65 minutes", and a team can breach the first while respecting the second.
 *
 * Everything here is pure so the team console, race control and the tests all
 * apply the same rules.
 */

export const LINEUP_ROLE_LABELS: Record<LineupRole, string> = {
  DRIVER_OF_RECORD: "Driver of record",
  DRIVER: "Driver",
  RESERVE: "Reserve",
};

/** Roles that occupy a seat for the purposes of line-up size rules. */
export const COUNTED_LINEUP_ROLES: LineupRole[] = [
  LineupRole.DRIVER_OF_RECORD,
  LineupRole.DRIVER,
];

export interface LineupEntry {
  id: string;
  userId: string;
  role: LineupRole;
}

export interface StintRecord {
  id: string;
  lineupDriverId: string | null;
  startedAt: Date;
  /** Null while the driver is still in the car. */
  endedAt: Date | null;
}

/** The subset of an event's regulations that concerns line-ups. */
export interface DriveTimeRules {
  minDriversPerEntry?: number | null;
  maxDriversPerEntry?: number | null;
  maxStintMinutes?: number | null;
  minStintMinutes?: number | null;
  maxDriveMinutesPerDriver?: number | null;
  minDriveMinutesPerDriver?: number | null;
}

/** True when an event has any line-up regulation worth enforcing. */
export function hasDriveTimeRules(rules: DriveTimeRules): boolean {
  return Object.values(rules).some(
    (value) => value !== null && value !== undefined,
  );
}

/**
 * Minutes in a stint. An open stint is measured to `now`, so a live board can
 * show a driver approaching a stint limit rather than only after they stop.
 */
export function stintMinutes(stint: StintRecord, now = new Date()): number {
  const end = stint.endedAt ?? now;
  const ms = end.getTime() - stint.startedAt.getTime();
  return ms <= 0 ? 0 : ms / 60000;
}

export interface DriverDriveTime {
  lineupDriverId: string;
  totalMinutes: number;
  stintCount: number;
  longestStintMinutes: number;
  /** True if one of their stints has no end time yet. */
  inCar: boolean;
}

/**
 * Drive time per driver. Stints whose driver has been removed from the line-up
 * (`lineupDriverId` null) are deliberately excluded from per-driver totals —
 * they still happened, but they can no longer be attributed.
 */
export function driveTimeByDriver(
  stints: StintRecord[],
  now = new Date(),
): Map<string, DriverDriveTime> {
  const totals = new Map<string, DriverDriveTime>();
  for (const stint of stints) {
    if (!stint.lineupDriverId) continue;
    const minutes = stintMinutes(stint, now);
    const existing = totals.get(stint.lineupDriverId) ?? {
      lineupDriverId: stint.lineupDriverId,
      totalMinutes: 0,
      stintCount: 0,
      longestStintMinutes: 0,
      inCar: false,
    };
    existing.totalMinutes += minutes;
    existing.stintCount += 1;
    existing.longestStintMinutes = Math.max(
      existing.longestStintMinutes,
      minutes,
    );
    if (stint.endedAt === null) existing.inCar = true;
    totals.set(stint.lineupDriverId, existing);
  }
  return totals;
}

export type ViolationCode =
  | "TOO_FEW_DRIVERS"
  | "TOO_MANY_DRIVERS"
  | "MULTIPLE_DRIVERS_OF_RECORD"
  | "OVERLAPPING_STINTS"
  | "STINT_TOO_LONG"
  | "STINT_TOO_SHORT"
  | "DRIVE_TIME_EXCEEDED"
  | "DRIVE_TIME_NOT_MET";

export interface LineupViolation {
  code: ViolationCode;
  message: string;
  /** Set when the problem belongs to one driver rather than the entry. */
  lineupDriverId?: string;
  /**
   * A breach that has already happened, versus one that only matters once the
   * session is over — a driver under their minimum mid-race is not yet a
   * problem, so race control should not be shown it as one.
   */
  severity: "breach" | "pending";
}

export interface LineupCheckInput {
  lineup: LineupEntry[];
  stints: StintRecord[];
  rules: DriveTimeRules;
  /** Minimums only apply once the race is done. */
  sessionComplete?: boolean;
  now?: Date;
}

/**
 * Every way a line-up or its drive time breaks the event's regulations.
 *
 * Returns findings rather than throwing: race control wants to see a car
 * approaching a limit, and an organizer needs to be able to confirm an entry
 * that is still being assembled.
 */
export function checkLineup(input: LineupCheckInput): LineupViolation[] {
  const { lineup, stints, rules } = input;
  const now = input.now ?? new Date();
  const sessionComplete = input.sessionComplete ?? false;
  const violations: LineupViolation[] = [];

  const counted = lineup.filter((entry) =>
    COUNTED_LINEUP_ROLES.includes(entry.role),
  );

  if (
    rules.minDriversPerEntry != null &&
    counted.length < rules.minDriversPerEntry
  ) {
    violations.push({
      code: "TOO_FEW_DRIVERS",
      message: `This event needs at least ${rules.minDriversPerEntry} declared drivers; ${counted.length} declared.`,
      severity: "breach",
    });
  }
  if (
    rules.maxDriversPerEntry != null &&
    counted.length > rules.maxDriversPerEntry
  ) {
    violations.push({
      code: "TOO_MANY_DRIVERS",
      message: `This event allows at most ${rules.maxDriversPerEntry} drivers; ${counted.length} declared.`,
      severity: "breach",
    });
  }

  const driversOfRecord = lineup.filter(
    (entry) => entry.role === LineupRole.DRIVER_OF_RECORD,
  );
  if (driversOfRecord.length > 1) {
    violations.push({
      code: "MULTIPLE_DRIVERS_OF_RECORD",
      message: "Only one driver of record can be nominated per entry.",
      severity: "breach",
    });
  }

  for (const overlap of overlappingStints(stints)) {
    violations.push({
      code: "OVERLAPPING_STINTS",
      message: `Two stints overlap in time — only one driver can be in the car at once (${overlap}).`,
      severity: "breach",
    });
  }

  const byDriver = driveTimeByDriver(stints, now);

  for (const entry of counted) {
    const drive = byDriver.get(entry.id);
    const total = drive?.totalMinutes ?? 0;

    if (
      rules.maxStintMinutes != null &&
      drive &&
      drive.longestStintMinutes > rules.maxStintMinutes
    ) {
      violations.push({
        code: "STINT_TOO_LONG",
        lineupDriverId: entry.id,
        message: `Longest stint ${round(drive.longestStintMinutes)} min exceeds the ${rules.maxStintMinutes} min limit.`,
        severity: "breach",
      });
    }

    if (
      rules.maxDriveMinutesPerDriver != null &&
      total > rules.maxDriveMinutesPerDriver
    ) {
      violations.push({
        code: "DRIVE_TIME_EXCEEDED",
        lineupDriverId: entry.id,
        message: `Total drive time ${round(total)} min exceeds the ${rules.maxDriveMinutesPerDriver} min limit.`,
        severity: "breach",
      });
    }

    if (
      rules.minDriveMinutesPerDriver != null &&
      total < rules.minDriveMinutesPerDriver
    ) {
      violations.push({
        code: "DRIVE_TIME_NOT_MET",
        lineupDriverId: entry.id,
        message: `Total drive time ${round(total)} min is under the ${rules.minDriveMinutesPerDriver} min minimum.`,
        // Only a breach once there is no more time to fix it.
        severity: sessionComplete ? "breach" : "pending",
      });
    }
  }

  // A short stint only counts as a breach once it has actually ended: a driver
  // two minutes into a stint has not yet broken a minimum-stint rule.
  if (rules.minStintMinutes != null) {
    for (const stint of stints) {
      if (stint.endedAt === null) continue;
      const minutes = stintMinutes(stint, now);
      if (minutes < rules.minStintMinutes) {
        violations.push({
          code: "STINT_TOO_SHORT",
          lineupDriverId: stint.lineupDriverId ?? undefined,
          message: `A ${round(minutes)} min stint is under the ${rules.minStintMinutes} min minimum stint.`,
          severity: "breach",
        });
      }
    }
  }

  return violations;
}

/** Only the findings that are already regulation breaches. */
export function breaches(violations: LineupViolation[]): LineupViolation[] {
  return violations.filter((violation) => violation.severity === "breach");
}

/** Human-readable descriptions of any pairs of stints that overlap. */
function overlappingStints(stints: StintRecord[]): string[] {
  const ordered = [...stints].sort(
    (a, b) => a.startedAt.getTime() - b.startedAt.getTime(),
  );
  const found: string[] = [];
  for (let i = 0; i < ordered.length; i++) {
    for (let j = i + 1; j < ordered.length; j++) {
      const a = ordered[i];
      const b = ordered[j];
      // An open stint runs indefinitely, so anything starting after it overlaps.
      const aEnd = a.endedAt;
      if (aEnd !== null && b.startedAt >= aEnd) break;
      const bEnd = b.endedAt;
      const overlaps =
        aEnd === null || bEnd === null ? true : a.startedAt < bEnd;
      if (overlaps) found.push(`${a.id} / ${b.id}`);
    }
  }
  return found;
}

/** Minutes to one decimal place, for messages. */
function round(minutes: number): number {
  return Math.round(minutes * 10) / 10;
}

/** "2h 14m" for a duration in minutes, or "—" when there is none. */
export function formatDriveTime(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || minutes <= 0) return "—";
  const whole = Math.round(minutes);
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;
  return hours > 0 ? `${hours}h ${rest}m` : `${rest}m`;
}
