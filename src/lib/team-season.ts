import { ResultStatus } from "@prisma/client";
import type { PenaltyStatus } from "@prisma/client";
import { penaltyCountsAgainstPoints } from "@/lib/standings";
import type { StandingsRow } from "@/lib/standings";

/**
 * A team's season across every series it races in.
 *
 * Championship points are not recomputed here — they come from the series
 * standings, which are the authoritative table including penalty deductions.
 * This module locates the team's row in each of those tables and rolls the
 * per-event results up alongside it.
 */

export interface TeamEventResult {
  eventId: string;
  eventName: string;
  eventDate: Date;
  seriesId: string | null;
  seriesName: string;
  registrationId: string;
  carNumber: string | null;
  carClass: string | null;
  finishPosition: number | null;
  status: ResultStatus | null;
  fastestLap: boolean;
  /** Penalties logged against this entry that still stand. */
  activePenalties: number;
}

export interface TeamSeriesSummary {
  seriesId: string;
  seriesName: string;
  seriesSlug: string;
  /** 1-based position in the championship table, or null if unclassified. */
  position: number | null;
  /** How many competitors are in that table, for "3rd of 18". */
  fieldSize: number;
  points: number;
  starts: number;
  wins: number;
  podiums: number;
  bestFinish: number | null;
  pointsDeducted: number;
  penaltyCount: number;
}

/**
 * Finds a team's row in a computed standings table and returns it with its
 * position. Standings rows are keyed by team id for team entries, so the
 * lookup is exact rather than by name.
 */
export function teamStandingsPosition(
  rows: StandingsRow[],
  teamId: string,
): { row: StandingsRow; position: number } | null {
  const index = rows.findIndex((row) => row.teamId === teamId);
  if (index === -1) return null;
  return { row: rows[index], position: index + 1 };
}

export function summarizeTeamSeries(
  series: { id: string; name: string; slug: string },
  rows: StandingsRow[],
  teamId: string,
): TeamSeriesSummary {
  const found = teamStandingsPosition(rows, teamId);
  return {
    seriesId: series.id,
    seriesName: series.name,
    seriesSlug: series.slug,
    position: found?.position ?? null,
    fieldSize: rows.length,
    points: found?.row.points ?? 0,
    starts: found?.row.starts ?? 0,
    wins: found?.row.wins ?? 0,
    podiums: found?.row.podiums ?? 0,
    bestFinish: found?.row.bestFinish ?? null,
    pointsDeducted: found?.row.pointsDeducted ?? 0,
    penaltyCount: found?.row.penaltyCount ?? 0,
  };
}

export interface TeamSeasonTotals {
  seriesCount: number;
  starts: number;
  wins: number;
  podiums: number;
  bestFinish: number | null;
  totalPoints: number;
}

/**
 * Career-style totals across every series. Points are summed for a headline
 * figure only — points from different championships are not comparable, so the
 * per-series breakdown is what the UI leads with.
 */
export function totalsAcrossSeries(
  summaries: TeamSeriesSummary[],
): TeamSeasonTotals {
  let bestFinish: number | null = null;
  for (const summary of summaries) {
    if (
      summary.bestFinish !== null &&
      (bestFinish === null || summary.bestFinish < bestFinish)
    ) {
      bestFinish = summary.bestFinish;
    }
  }
  return {
    seriesCount: summaries.length,
    starts: sum(summaries.map((s) => s.starts)),
    wins: sum(summaries.map((s) => s.wins)),
    podiums: sum(summaries.map((s) => s.podiums)),
    bestFinish,
    totalPoints: sum(summaries.map((s) => s.points)),
  };
}

/** Counts the penalties on an entry that still stand against the team. */
export function countActivePenalties(
  penalties: { status: PenaltyStatus }[],
): number {
  return penalties.filter((penalty) => penaltyCountsAgainstPoints(penalty.status))
    .length;
}

/** Results newest first — a team looks at the last race before the first. */
export function orderResultsByRecency(
  results: TeamEventResult[],
): TeamEventResult[] {
  return [...results].sort(
    (a, b) => b.eventDate.getTime() - a.eventDate.getTime(),
  );
}

/**
 * Splits a team's calendar into what is still to come and what has run.
 * Upcoming is ascending (next race first); past is descending.
 */
export function splitSchedule<T extends { date: Date }>(
  events: T[],
  now = new Date(),
): { upcoming: T[]; past: T[] } {
  const upcoming: T[] = [];
  const past: T[] = [];
  for (const event of events) {
    if (event.date.getTime() >= now.getTime()) upcoming.push(event);
    else past.push(event);
  }
  upcoming.sort((a, b) => a.date.getTime() - b.date.getTime());
  past.sort((a, b) => b.date.getTime() - a.date.getTime());
  return { upcoming, past };
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
