import { EventStatus, PenaltyStatus, RegistrationStatus } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { computeSeriesStandings, selectTable } from "@/server/services/standings";
import { parsePointsScheme } from "@/lib/standings";
import { buildEntryList } from "@/lib/race-documents";
import { eventVenueLabel } from "@/lib/tracks";
import {
  maxRoundPoints,
  talkingPoints,
  titleStillPossible,
  type CommentatorEntry,
  type CommentatorPack,
} from "@/lib/broadcast";

/**
 * The commentator pack: the entry list with what each entry means for the
 * championship.
 *
 * Commentators currently build this by hand from a results PDF and a
 * standings page. Everything in it already exists here — the entry list, the
 * standings, the penalty record — so the pack is an assembly job.
 */

export async function commentatorPack(
  db: PrismaClient,
  eventId: string,
): Promise<CommentatorPack | null> {
  const event = await db.raceEvent.findUnique({
    where: { id: eventId },
    select: {
      id: true,
      name: true,
      date: true,
      venue: true,
      seriesId: true,
      trackLayout: {
        select: { name: true, track: { select: { name: true } } },
      },
      series: {
        select: {
          name: true,
          pointsScheme: true,
          fastestLapPoints: true,
        },
      },
    },
  });
  if (!event) return null;

  const registrations = await db.eventRegistration.findMany({
    where: { eventId, status: RegistrationStatus.CONFIRMED },
    select: {
      id: true,
      carNumber: true,
      carClass: true,
      status: true,
      teamId: true,
      entrantUserId: true,
      team: { select: { name: true } },
      entrantUser: { select: { profile: { select: { displayName: true } } } },
      seriesClass: { select: { name: true, code: true } },
      lineup: {
        select: { user: { select: { profile: { select: { displayName: true } } } } },
      },
      car: { select: { name: true, make: true, model: true } },
      transponders: {
        select: { isPrimary: true, transponder: { select: { number: true } } },
      },
      paddock: { select: { garage: true } },
    },
  });

  const entryRows = buildEntryList(registrations);

  // Rounds still to run after this one, for the "mathematically in it" line.
  const roundsRemaining = event.seriesId
    ? await db.raceEvent.count({
        where: {
          seriesId: event.seriesId,
          status: { not: EventStatus.CANCELED },
          date: { gte: event.date },
          id: { not: eventId },
        },
      })
    : 0;

  const standings = event.seriesId
    ? await computeSeriesStandings(db, event.seriesId)
    : null;
  const table = standings ? selectTable(standings, "entrant", null) : null;

  // Penalties are counted per competitor across the season, not per
  // registration: an entry is a different row every round, so keying on
  // registration id would only ever count this weekend's penalties while
  // claiming to be a season record.
  const penalties = await db.penalty.findMany({
    where: {
      registration: {
        event: event.seriesId ? { seriesId: event.seriesId } : { id: eventId },
      },
      status: { not: PenaltyStatus.OVERTURNED },
    },
    select: {
      registration: { select: { teamId: true, entrantUserId: true, id: true } },
    },
  });
  const penaltyCounts = new Map<string, number>();
  for (const penalty of penalties) {
    const key =
      penalty.registration.teamId ??
      penalty.registration.entrantUserId ??
      penalty.registration.id;
    penaltyCounts.set(key, (penaltyCounts.get(key) ?? 0) + 1);
  }

  const leaderPoints = table?.rows[0]?.points ?? 0;
  const scheme = event.series
    ? parsePointsScheme(event.series.pointsScheme)
    : null;
  const perRound = scheme
    ? maxRoundPoints(scheme, event.series?.fastestLapPoints ?? 0)
    : 0;

  const entries: CommentatorEntry[] = entryRows.map((row) => {
    const registration = registrations.find((r) => r.id === row.registrationId);
    // Standings key on the team or the individual entrant, matching how the
    // championship itself is scored.
    const key =
      registration?.teamId ?? registration?.entrantUserId ?? row.registrationId;
    const standing = table?.rows.find((r) => r.competitorKey === key) ?? null;

    return {
      carNumber: row.carNumber,
      entrant: row.entrant,
      className: row.className,
      drivers: row.drivers,
      car: row.car,
      championshipPosition: standing
        ? (table!.rows.indexOf(standing) + 1)
        : null,
      championshipPoints: standing?.points ?? null,
      pointsBehindLeader: standing
        ? Math.max(0, leaderPoints - standing.points)
        : null,
      starts: standing?.starts ?? 0,
      wins: standing?.wins ?? 0,
      podiums: standing?.podiums ?? 0,
      penaltyCount: penaltyCounts.get(key) ?? 0,
      titleStillPossible:
        standing && perRound > 0
          ? titleStillPossible(
              standing.points,
              leaderPoints,
              roundsRemaining,
              perRound,
            )
          : null,
    };
  });

  return {
    event: {
      id: event.id,
      name: event.name,
      date: event.date,
      venue: eventVenueLabel(event),
    },
    series: event.series
      ? { name: event.series.name, roundsRemaining }
      : null,
    entries,
    talkingPoints: table
      ? talkingPoints(
          table.rows.map((row) => ({
            competitorKey: row.competitorKey,
            competitorLabel: row.competitorLabel,
            points: row.points,
            starts: row.starts,
            wins: row.wins,
            podiums: row.podiums,
            penaltyCount: row.penaltyCount,
            titleEligible: row.titleEligible,
          })),
          roundsRemaining,
          perRound,
        )
      : [],
  };
}
