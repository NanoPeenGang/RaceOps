import { EventStatus, RegistrationStatus } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { computeStandings, parsePointsScheme } from "@/lib/standings";
import type { StandingsRow } from "@/lib/standings";

/**
 * Builds a series championship table from the database.
 *
 * Shared by the series standings page and the team dashboard, which needs the
 * same table to locate a team's position — recomputing points in two places
 * would eventually let them disagree.
 */
export async function computeSeriesStandings(
  db: PrismaClient,
  seriesId: string,
): Promise<{
  rows: StandingsRow[];
  scheme: Record<number, number>;
  fastestLapPoints: number;
} | null> {
  const series = await db.series.findUnique({
    where: { id: seriesId },
    select: { pointsScheme: true, fastestLapPoints: true },
  });
  if (!series) return null;

  // Only classified events count toward the championship.
  const registrations = await db.eventRegistration.findMany({
    where: {
      event: { seriesId, status: EventStatus.COMPLETED },
      status: RegistrationStatus.CONFIRMED,
    },
    select: {
      id: true,
      teamId: true,
      team: { select: { name: true } },
      entrantUserId: true,
      entrantUser: { select: { profile: { select: { displayName: true } } } },
      result: {
        select: {
          registrationId: true,
          finishPosition: true,
          status: true,
          fastestLap: true,
          pointsOverride: true,
        },
      },
      penalties: {
        select: { registrationId: true, status: true, pointsDeducted: true },
      },
    },
  });

  const entries = registrations.map((registration) => ({
    registrationId: registration.id,
    competitorKey:
      registration.teamId ?? registration.entrantUserId ?? registration.id,
    competitorLabel:
      registration.team?.name ??
      registration.entrantUser?.profile?.displayName ??
      "Unknown competitor",
    teamId: registration.teamId,
  }));

  const scheme = parsePointsScheme(series.pointsScheme);
  const fastestLapPoints = series.fastestLapPoints ?? 0;

  return {
    rows: computeStandings({
      entries,
      results: registrations
        .map((r) => r.result)
        .filter((r): r is NonNullable<typeof r> => r !== null),
      penalties: registrations.flatMap((r) => r.penalties),
      scheme,
      fastestLapPoints,
    }),
    scheme,
    fastestLapPoints,
  };
}
