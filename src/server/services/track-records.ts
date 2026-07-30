import { EventStatus, SessionStatus } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { sessionWasWet } from "@/lib/conditions";
import { trackRecords } from "@/lib/tracks";
import type { RecordLap, RecordOptions, TrackRecord } from "@/lib/tracks";

/**
 * Lap records for a track layout, assembled from live timing.
 *
 * The timing board already holds every entry's best lap for every session, so
 * a record is a query rather than a thing anyone has to remember to record.
 * Laps are only drawn from finished sessions of completed events: a board
 * still running is a leaderboard, not a record.
 */

export interface LayoutRecords {
  layout: {
    id: string;
    name: string;
    platform: string | null;
    lengthMeters: number | null;
    track: { id: string; name: string; slug: string };
  };
  overall: TrackRecord | null;
  byClass: TrackRecord[];
  /** Laps considered, so a page can say "from 412 laps across 9 meetings". */
  lapsConsidered: number;
}

export async function trackRecordsForLayout(
  db: PrismaClient,
  layoutId: string,
  options: RecordOptions & { seriesId?: string } = {},
): Promise<LayoutRecords | null> {
  const layout = await db.trackLayout.findUnique({
    where: { id: layoutId },
    select: {
      id: true,
      name: true,
      platform: true,
      lengthMeters: true,
      track: { select: { id: true, name: true, slug: true } },
    },
  });
  if (!layout) return null;

  const timing = await db.timingEntry.findMany({
    where: {
      bestLapMs: { not: null },
      session: {
        status: SessionStatus.FINISHED,
        event: {
          trackLayoutId: layoutId,
          status: EventStatus.COMPLETED,
          ...(options.seriesId ? { seriesId: options.seriesId } : {}),
        },
      },
    },
    select: {
      registrationId: true,
      bestLapMs: true,
      session: {
        select: {
          id: true,
          name: true,
          type: true,
          event: { select: { id: true, name: true, date: true } },
          conditions: { select: { recordedAt: true, trackState: true } },
        },
      },
      registration: {
        select: {
          seriesClassId: true,
          seriesClass: { select: { name: true } },
          teamId: true,
          team: { select: { name: true } },
          carNumber: true,
          entrantUser: {
            select: { profile: { select: { displayName: true } } },
          },
        },
      },
    },
  });

  const laps: RecordLap[] = timing.map((entry) => {
    const registration = entry.registration;
    const name =
      registration.team?.name ??
      registration.entrantUser?.profile?.displayName ??
      "Unknown entry";
    return {
      registrationId: entry.registrationId,
      competitorLabel: registration.carNumber
        ? `#${registration.carNumber} ${name}`
        : name,
      teamId: registration.teamId,
      seriesClassId: registration.seriesClassId,
      seriesClassName: registration.seriesClass?.name ?? null,
      eventId: entry.session.event.id,
      eventName: entry.session.event.name,
      eventDate: entry.session.event.date,
      sessionId: entry.session.id,
      sessionName: entry.session.name,
      sessionType: entry.session.type,
      // Non-null by the query filter; Prisma still types it as nullable.
      lapMs: entry.bestLapMs ?? 0,
      // Null when the session logged no conditions, which is not the same as
      // dry — laps from before conditions were captured stay admissible.
      wet: sessionWasWet(entry.session.conditions),
    };
  });

  const { overall, byClass } = trackRecords(laps, options);
  return { layout, overall, byClass, lapsConsidered: laps.length };
}
