import { SessionType } from "@prisma/client";

/**
 * Running-order helpers for multi-day meetings. Pure functions so the
 * organizer UI and the public schedule share the same grouping and
 * clash-detection rules.
 */

export const SESSION_TYPE_LABELS: Record<SessionType, string> = {
  PRACTICE: "Practice",
  QUALIFYING: "Qualifying",
  RACE: "Race",
  WARMUP: "Warm-up",
  SCRUTINEERING: "Scrutineering",
  DRIVER_BRIEFING: "Driver briefing",
  MEDIA: "Media",
  SUPPORT: "Support race",
  OTHER: "Other",
};

export interface ScheduledSession {
  id: string;
  name: string;
  type: SessionType;
  startsAt: Date;
  endsAt: Date;
}

export interface ScheduleDay<T extends ScheduledSession> {
  /** Local calendar day key, YYYY-MM-DD. */
  dayKey: string;
  date: Date;
  sessions: T[];
}

/** Local calendar day for a timestamp (not UTC — a race weekend is local). */
export function dayKeyOf(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Groups sessions into days, each ordered by start time, days ascending.
 * This is what turns a flat session list into a Friday/Saturday/Sunday
 * running order.
 */
export function groupSessionsByDay<T extends ScheduledSession>(
  sessions: T[],
): ScheduleDay<T>[] {
  const days = new Map<string, ScheduleDay<T>>();
  for (const session of sessions) {
    const dayKey = dayKeyOf(session.startsAt);
    if (!days.has(dayKey)) {
      const date = new Date(session.startsAt);
      date.setHours(0, 0, 0, 0);
      days.set(dayKey, { dayKey, date, sessions: [] });
    }
    days.get(dayKey)!.sessions.push(session);
  }
  const ordered = [...days.values()].sort((a, b) =>
    a.dayKey.localeCompare(b.dayKey),
  );
  for (const day of ordered) {
    day.sessions.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  }
  return ordered;
}

/** True when two sessions overlap in time (touching endpoints do not). */
export function sessionsOverlap(
  a: Pick<ScheduledSession, "startsAt" | "endsAt">,
  b: Pick<ScheduledSession, "startsAt" | "endsAt">,
): boolean {
  return a.startsAt < b.endsAt && b.startsAt < a.endsAt;
}

/**
 * Every pair of sessions that clash. Organizers get warned rather than
 * blocked — support paddocks legitimately run parallel activities.
 */
export function findScheduleClashes<T extends ScheduledSession>(
  sessions: T[],
): Array<[T, T]> {
  const clashes: Array<[T, T]> = [];
  const ordered = [...sessions].sort(
    (a, b) => a.startsAt.getTime() - b.startsAt.getTime(),
  );
  for (let i = 0; i < ordered.length; i++) {
    for (let j = i + 1; j < ordered.length; j++) {
      // Sorted by start, so once one starts after this ends, so do the rest.
      if (ordered[j].startsAt >= ordered[i].endsAt) break;
      if (sessionsOverlap(ordered[i], ordered[j])) {
        clashes.push([ordered[i], ordered[j]]);
      }
    }
  }
  return clashes;
}

/** Inclusive span of a meeting, derived from its sessions. */
export function scheduleSpan<T extends ScheduledSession>(
  sessions: T[],
): { start: Date; end: Date; days: number } | null {
  if (sessions.length === 0) return null;
  let start = sessions[0].startsAt;
  let end = sessions[0].endsAt;
  for (const session of sessions) {
    if (session.startsAt < start) start = session.startsAt;
    if (session.endsAt > end) end = session.endsAt;
  }
  const uniqueDays = new Set(sessions.map((s) => dayKeyOf(s.startsAt)));
  return { start, end, days: uniqueDays.size };
}
