import { stintMinutes } from "@/lib/lineup";
import type { StintRecord } from "@/lib/lineup";

/**
 * Seat time across a season, per driver.
 *
 * `lineup.ts` answers "is this entry legal right now" — drive time within one
 * event, against that event's regulations. This answers a different question a
 * team asks between events: who has actually been in the car this year, and
 * who is owed a stint.
 *
 * They deliberately share `stintMinutes`, so a minute counted at an event and
 * a minute counted across a season are the same minute.
 */

export interface SeasonStint extends StintRecord {
  /** Which entry the stint belongs to, so events can be counted. */
  registrationId: string;
  eventId: string;
  eventName: string;
  eventDate: Date;
  /** The driver this stint is attributed to. Null once they leave a line-up. */
  userId: string | null;
  laps?: number | null;
}

export interface DriverSeatTime {
  userId: string;
  totalMinutes: number;
  stintCount: number;
  eventCount: number;
  longestStintMinutes: number;
  laps: number;
  /** Most recent event this driver ran, for "last out: Sebring, March". */
  lastEventName: string | null;
  lastEventDate: Date | null;
  /** True while one of their stints is still open. */
  inCar: boolean;
}

export interface SeatTimeSummary {
  drivers: DriverSeatTime[];
  totalMinutes: number;
  /**
   * Minutes from stints whose driver has since left every line-up.
   *
   * Reported rather than dropped or folded into a driver's total: those
   * minutes happened and they belong in the team's hours, but attributing them
   * to somebody would be a guess. A team that sees a large number here has a
   * roster edit to explain, which is worth knowing.
   */
  unattributedMinutes: number;
}

/**
 * Seat time per driver across a set of stints, busiest first.
 *
 * Open stints count up to `now`, matching the event view — a driver currently
 * in the car should not appear to have done nothing this weekend.
 */
export function seatTimeByDriver(
  stints: readonly SeasonStint[],
  now: Date = new Date(),
): SeatTimeSummary {
  const byDriver = new Map<string, DriverSeatTime>();
  const eventsSeen = new Map<string, Set<string>>();
  let unattributedMinutes = 0;
  let totalMinutes = 0;

  for (const stint of stints) {
    const minutes = stintMinutes(stint, now);
    totalMinutes += minutes;

    if (!stint.userId) {
      unattributedMinutes += minutes;
      continue;
    }

    const current = byDriver.get(stint.userId) ?? {
      userId: stint.userId,
      totalMinutes: 0,
      stintCount: 0,
      eventCount: 0,
      longestStintMinutes: 0,
      laps: 0,
      lastEventName: null,
      lastEventDate: null,
      inCar: false,
    };

    current.totalMinutes += minutes;
    current.stintCount += 1;
    current.longestStintMinutes = Math.max(
      current.longestStintMinutes,
      minutes,
    );
    current.laps += stint.laps ?? 0;
    if (stint.endedAt === null) current.inCar = true;

    if (
      current.lastEventDate === null ||
      stint.eventDate.getTime() > current.lastEventDate.getTime()
    ) {
      current.lastEventDate = stint.eventDate;
      current.lastEventName = stint.eventName;
    }

    const events = eventsSeen.get(stint.userId) ?? new Set<string>();
    events.add(stint.eventId);
    eventsSeen.set(stint.userId, events);
    current.eventCount = events.size;

    byDriver.set(stint.userId, current);
  }

  return {
    drivers: [...byDriver.values()].sort(
      (a, b) => b.totalMinutes - a.totalMinutes,
    ),
    totalMinutes,
    unattributedMinutes,
  };
}

/**
 * How evenly the seat time is split, 0 to 1.
 *
 * 1 is a perfectly even split; 0 is one driver doing everything. Computed as
 * the mean absolute deviation from an equal share, normalised — a plain
 * standard deviation would be harder to explain and no more useful.
 *
 * Null for fewer than two drivers: a solo entry is not unbalanced, it is solo,
 * and reporting 0 would read as a problem.
 */
export function seatTimeBalance(
  drivers: readonly DriverSeatTime[],
): number | null {
  if (drivers.length < 2) return null;
  const total = drivers.reduce((sum, driver) => sum + driver.totalMinutes, 0);
  if (total <= 0) return null;

  const fairShare = total / drivers.length;
  const deviation =
    drivers.reduce(
      (sum, driver) => sum + Math.abs(driver.totalMinutes - fairShare),
      0,
    ) / drivers.length;

  // Worst case is one driver holding everything, where mean deviation tends to
  // 2·fairShare·(n-1)/n. Dividing by that puts the result on 0..1.
  const worst = (2 * fairShare * (drivers.length - 1)) / drivers.length;
  return worst === 0 ? 1 : Math.max(0, 1 - deviation / worst);
}

/** "4h 12m", "38m" — a duration as a team would say it out loud. */
export function formatMinutes(minutes: number): string {
  const whole = Math.round(minutes);
  if (whole < 60) return `${whole}m`;
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/**
 * Drivers on the roster who have not been in the car at all.
 *
 * The list a manager actually wants: a driver with zero seat time does not
 * appear in `seatTimeByDriver` at all, because they have no stints, so
 * "who is owed a run" cannot be answered from that map alone.
 */
export function driversWithoutSeatTime(
  rosterUserIds: readonly string[],
  drivers: readonly DriverSeatTime[],
): string[] {
  const seen = new Set(drivers.map((driver) => driver.userId));
  return rosterUserIds.filter((userId) => !seen.has(userId));
}
