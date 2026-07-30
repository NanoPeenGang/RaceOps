import { PenaltyStatus, ResultStatus } from "@prisma/client";

/**
 * Series points and standings. Pure functions over plain records so they can
 * be tested directly and reused by both the router and the UI.
 */

export const RESULT_STATUS_LABELS: Record<ResultStatus, string> = {
  FINISHED: "Finished",
  DNF: "DNF",
  DNS: "DNS",
  DSQ: "Disqualified",
};

/** FIA-style top-10 scoring, used when a series defines no scheme. */
export const DEFAULT_POINTS_SCHEME: Record<number, number> = {
  1: 25,
  2: 18,
  3: 15,
  4: 12,
  5: 10,
  6: 8,
  7: 6,
  8: 4,
  9: 2,
  10: 1,
};

/**
 * Normalizes a stored scheme (JSON with string keys) into a position->points
 * map. Invalid entries are dropped rather than throwing, so one bad value in
 * an organizer's custom scheme cannot take down the standings page.
 */
export function parsePointsScheme(raw: unknown): Record<number, number> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return DEFAULT_POINTS_SCHEME;
  }
  const parsed: Record<number, number> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const position = Number(key);
    const points = Number(value);
    if (
      Number.isInteger(position) &&
      position > 0 &&
      Number.isFinite(points) &&
      points >= 0
    ) {
      parsed[position] = points;
    }
  }
  return Object.keys(parsed).length > 0 ? parsed : DEFAULT_POINTS_SCHEME;
}

export interface ScoringResult {
  registrationId: string;
  finishPosition: number | null;
  status: ResultStatus;
  fastestLap: boolean;
  pointsOverride: number | null;
}

/** Points for a single result, before penalty deductions. */
export function pointsForResult(
  result: ScoringResult,
  scheme: Record<number, number>,
  fastestLapPoints = 0,
): number {
  if (result.pointsOverride !== null) return Math.max(0, result.pointsOverride);
  // A disqualified or non-starting entry scores nothing, fastest lap included.
  if (result.status !== ResultStatus.FINISHED) return 0;
  if (result.finishPosition === null) return 0;

  const base = scheme[result.finishPosition] ?? 0;
  const bonus = result.fastestLap ? fastestLapPoints : 0;
  return base + bonus;
}

/** Penalty statuses that still cost the competitor points. */
export const ACTIVE_PENALTY_STATUSES: PenaltyStatus[] = [
  PenaltyStatus.ISSUED,
  PenaltyStatus.UNDER_APPEAL,
  PenaltyStatus.UPHELD,
  PenaltyStatus.REDUCED,
];

export function penaltyCountsAgainstPoints(status: PenaltyStatus): boolean {
  return ACTIVE_PENALTY_STATUSES.includes(status);
}

export interface StandingsInput {
  /** One row per entry across the whole series. */
  entries: {
    registrationId: string;
    competitorKey: string;
    competitorLabel: string;
    teamId: string | null;
  }[];
  results: ScoringResult[];
  penalties: {
    registrationId: string;
    status: PenaltyStatus;
    pointsDeducted: number | null;
  }[];
  scheme: Record<number, number>;
  fastestLapPoints?: number;
}

export interface StandingsRow {
  competitorKey: string;
  competitorLabel: string;
  teamId: string | null;
  starts: number;
  wins: number;
  podiums: number;
  bestFinish: number | null;
  grossPoints: number;
  pointsDeducted: number;
  points: number;
  penaltyCount: number;
}

/**
 * Championship table. Points are gross scoring minus deductions from
 * penalties that still stand — overturning a penalty restores the points
 * automatically because the deduction stops counting.
 */
export function computeStandings(input: StandingsInput): StandingsRow[] {
  const { entries, results, penalties, scheme } = input;
  const fastestLapPoints = input.fastestLapPoints ?? 0;

  const resultByRegistration = new Map(
    results.map((result) => [result.registrationId, result]),
  );
  const entryByRegistration = new Map(
    entries.map((entry) => [entry.registrationId, entry]),
  );

  const rows = new Map<string, StandingsRow>();
  for (const entry of entries) {
    if (!rows.has(entry.competitorKey)) {
      rows.set(entry.competitorKey, {
        competitorKey: entry.competitorKey,
        competitorLabel: entry.competitorLabel,
        teamId: entry.teamId,
        starts: 0,
        wins: 0,
        podiums: 0,
        bestFinish: null,
        grossPoints: 0,
        pointsDeducted: 0,
        points: 0,
        penaltyCount: 0,
      });
    }
    const row = rows.get(entry.competitorKey)!;
    const result = resultByRegistration.get(entry.registrationId);
    if (!result) continue;

    if (result.status !== ResultStatus.DNS) row.starts += 1;
    row.grossPoints += pointsForResult(result, scheme, fastestLapPoints);

    if (result.status === ResultStatus.FINISHED && result.finishPosition) {
      if (result.finishPosition === 1) row.wins += 1;
      if (result.finishPosition <= 3) row.podiums += 1;
      if (row.bestFinish === null || result.finishPosition < row.bestFinish) {
        row.bestFinish = result.finishPosition;
      }
    }
  }

  for (const penalty of penalties) {
    const entry = entryByRegistration.get(penalty.registrationId);
    if (!entry) continue;
    const row = rows.get(entry.competitorKey);
    if (!row) continue;
    row.penaltyCount += 1;
    if (
      penaltyCountsAgainstPoints(penalty.status) &&
      penalty.pointsDeducted &&
      penalty.pointsDeducted > 0
    ) {
      row.pointsDeducted += penalty.pointsDeducted;
    }
  }

  for (const row of rows.values()) {
    // A deduction can zero a competitor out but never push them negative.
    row.points = Math.max(0, row.grossPoints - row.pointsDeducted);
  }

  return [...rows.values()].sort(compareStandings);
}

/** Points, then wins, then podiums, then best finish, then name. */
function compareStandings(a: StandingsRow, b: StandingsRow): number {
  if (b.points !== a.points) return b.points - a.points;
  if (b.wins !== a.wins) return b.wins - a.wins;
  if (b.podiums !== a.podiums) return b.podiums - a.podiums;
  const aBest = a.bestFinish ?? Number.MAX_SAFE_INTEGER;
  const bBest = b.bestFinish ?? Number.MAX_SAFE_INTEGER;
  if (aBest !== bBest) return aBest - bBest;
  return a.competitorLabel.localeCompare(b.competitorLabel);
}
