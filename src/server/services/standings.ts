import { EventStatus, RegistrationStatus } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { computeStandings, parsePointsScheme } from "@/lib/standings";
import type {
  ChampionshipConfig,
  StandingsBasis,
  StandingsEntry,
  StandingsRow,
} from "@/lib/standings";

/**
 * Builds a series' championship tables from the database.
 *
 * A series publishes more than one table: an overall order, one per declared
 * class, and each of those in entrant, drivers' and teams' form. They all come
 * from a single query — recomputing points per table would eventually let them
 * disagree.
 */

export interface StandingsTable {
  /** Null for the overall table across every class. */
  seriesClassId: string | null;
  className: string | null;
  classCode: string | null;
  grouping: string | null;
  basis: StandingsBasis;
  rows: StandingsRow[];
}

export interface SeriesStandings {
  config: ChampionshipConfig;
  classes: {
    id: string;
    name: string;
    code: string | null;
    grouping: string | null;
    sortOrder: number;
  }[];
  /** Rounds counted so far, for "best 8 of 10" context. */
  roundsScored: number;
  tables: StandingsTable[];
}

export async function computeSeriesStandings(
  db: PrismaClient,
  seriesId: string,
): Promise<SeriesStandings | null> {
  const series = await db.series.findUnique({
    where: { id: seriesId },
    select: {
      pointsScheme: true,
      fastestLapPoints: true,
      countBestRounds: true,
      minStartsForTitle: true,
      classes: {
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        select: {
          id: true,
          name: true,
          code: true,
          grouping: true,
          sortOrder: true,
          pointsScheme: true,
          fastestLapPoints: true,
        },
      },
    },
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
      eventId: true,
      seriesClassId: true,
      teamId: true,
      team: { select: { name: true } },
      entrantUserId: true,
      entrantUser: { select: { profile: { select: { displayName: true } } } },
      event: { select: { pointsMultiplier: true } },
      lineup: {
        select: {
          userId: true,
          role: true,
          user: { select: { profile: { select: { displayName: true } } } },
        },
      },
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

  // Driver names are needed as labels on the drivers' table, where the key is
  // a user id rather than the entrant's name.
  const labels: Record<string, string> = {};
  for (const registration of registrations) {
    if (registration.teamId && registration.team) {
      labels[registration.teamId] = registration.team.name;
    }
    for (const driver of registration.lineup) {
      labels[driver.userId] =
        driver.user.profile?.displayName ?? "Unknown driver";
    }
    if (registration.entrantUserId) {
      labels[registration.entrantUserId] =
        registration.entrantUser?.profile?.displayName ?? "Unknown driver";
    }
  }

  const entries: StandingsEntry[] = registrations.map((registration) => ({
    registrationId: registration.id,
    eventId: registration.eventId,
    pointsMultiplier: registration.event.pointsMultiplier,
    seriesClassId: registration.seriesClassId,
    teamId: registration.teamId,
    // A declared crew scores together; a single-driver entry falls back to the
    // entrant so a sprint series still gets a drivers' table.
    driverIds:
      registration.lineup.length > 0
        ? registration.lineup.map((driver) => driver.userId)
        : registration.entrantUserId
          ? [registration.entrantUserId]
          : [],
    competitorKey:
      registration.teamId ?? registration.entrantUserId ?? registration.id,
    competitorLabel:
      registration.team?.name ??
      registration.entrantUser?.profile?.displayName ??
      "Unknown competitor",
  }));

  const results = registrations
    .map((r) => r.result)
    .filter((r): r is NonNullable<typeof r> => r !== null);
  const penalties = registrations.flatMap((r) => r.penalties);

  const seriesScheme = parsePointsScheme(series.pointsScheme);
  const baseConfig: ChampionshipConfig = {
    scheme: seriesScheme,
    fastestLapPoints: series.fastestLapPoints ?? 0,
    countBestRounds: series.countBestRounds,
    minStartsForTitle: series.minStartsForTitle,
  };

  const bases: StandingsBasis[] = ["entrant", "driver", "team"];
  const tables: StandingsTable[] = [];

  for (const basis of bases) {
    tables.push({
      seriesClassId: null,
      className: null,
      classCode: null,
      grouping: null,
      basis,
      rows: computeStandings({
        entries,
        results,
        penalties,
        config: baseConfig,
        basis,
        labels,
      }),
    });
  }

  for (const seriesClass of series.classes) {
    // A class may override the scale — grass-roots series routinely score a
    // 30-car class differently from a 4-car one.
    const classConfig: ChampionshipConfig = {
      ...baseConfig,
      scheme: seriesClass.pointsScheme
        ? parsePointsScheme(seriesClass.pointsScheme)
        : seriesScheme,
      fastestLapPoints:
        seriesClass.fastestLapPoints ?? baseConfig.fastestLapPoints,
    };

    for (const basis of bases) {
      tables.push({
        seriesClassId: seriesClass.id,
        className: seriesClass.name,
        classCode: seriesClass.code,
        grouping: seriesClass.grouping,
        basis,
        rows: computeStandings({
          entries,
          results,
          penalties,
          config: classConfig,
          basis,
          seriesClassId: seriesClass.id,
          labels,
        }),
      });
    }
  }

  return {
    config: baseConfig,
    classes: series.classes.map((seriesClass) => ({
      id: seriesClass.id,
      name: seriesClass.name,
      code: seriesClass.code,
      grouping: seriesClass.grouping,
      sortOrder: seriesClass.sortOrder,
    })),
    roundsScored: new Set(registrations.map((r) => r.eventId)).size,
    tables,
  };
}

/** Picks one table out of the set — the shape most callers actually want. */
export function selectTable(
  standings: SeriesStandings,
  basis: StandingsBasis,
  seriesClassId: string | null = null,
): StandingsTable | undefined {
  return standings.tables.find(
    (table) => table.basis === basis && table.seriesClassId === seriesClassId,
  );
}
