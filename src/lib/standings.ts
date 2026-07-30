import { PenaltyStatus, ResultStatus } from "@prisma/client";

/**
 * Series points and standings.
 *
 * Scoring happens in two passes: score each round on its own, then aggregate.
 * That order is what makes dropped scores possible ("best 8 of 10" needs to
 * know each round's points before it can discard the worst), and it keeps
 * per-round weighting — a double-points finale — in one place.
 *
 * Everything is pure over plain records, so the router, the team console and
 * the tests all score identically.
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

/** Points for a single result, before penalty deductions and weighting. */
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

// ---------------------------------------------------------------------------
// Championship configuration
// ---------------------------------------------------------------------------

/**
 * One championship table to produce. A series usually publishes several: an
 * overall table plus one per class, in both drivers' and teams' form.
 */
export type StandingsBasis = "entrant" | "driver" | "team";

export interface ChampionshipConfig {
  scheme: Record<number, number>;
  fastestLapPoints?: number;
  /** Score only this many best rounds. Null/undefined counts every round. */
  countBestRounds?: number | null;
  /** Rounds a competitor must start to be eligible for the title. */
  minStartsForTitle?: number | null;
}

export interface StandingsEntry {
  registrationId: string;
  eventId: string;
  /** Weighting for the round, e.g. 2 for a double-points finale. */
  pointsMultiplier?: number;
  /** Null for an entry not assigned to a declared class. */
  seriesClassId: string | null;
  teamId: string | null;
  /** Drivers who scored on this entry. Empty for a single-driver entry. */
  driverIds?: string[];
  /** Display name for the entrant-basis table. */
  competitorLabel: string;
  /** Stable key for the entrant-basis table. */
  competitorKey: string;
}

export interface StandingsInput {
  entries: StandingsEntry[];
  results: ScoringResult[];
  penalties: {
    registrationId: string;
    status: PenaltyStatus;
    pointsDeducted: number | null;
  }[];
  config: ChampionshipConfig;
  /** Which kind of table to build. Defaults to the entrant table. */
  basis?: StandingsBasis;
  /** Restrict to one class. Undefined scores every entry together. */
  seriesClassId?: string | null;
  /** Labels for driver/team keys, since those are ids rather than names. */
  labels?: Record<string, string>;
}

/** One round's contribution to a competitor's total. */
export interface RoundScore {
  eventId: string;
  registrationId: string;
  /** Points scored before deductions, after the round multiplier. */
  grossPoints: number;
  pointsDeducted: number;
  /** Gross minus deductions, floored at zero. */
  netPoints: number;
  started: boolean;
  finishPosition: number | null;
  penaltyCount: number;
  /** False when this round was discarded by a drop-scores rule. */
  counted: boolean;
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
  /** Rounds discarded because the series counts only its best N. */
  droppedRounds: number;
  /**
   * False when the competitor has not started enough rounds to take the
   * title. They still appear in the table — they scored the points — but a
   * series with a minimum-starts rule marks them ineligible.
   */
  titleEligible: boolean;
  rounds: RoundScore[];
}

/**
 * Championship table.
 *
 * Points are gross scoring minus deductions from penalties that still stand,
 * so overturning a penalty restores the points automatically. Deductions are
 * applied per round before any drop-scores rule, which is the order the
 * regulations imply: a competitor drops their worst *net* round.
 */
export function computeStandings(input: StandingsInput): StandingsRow[] {
  const basis = input.basis ?? "entrant";
  const { config } = input;
  const fastestLapPoints = config.fastestLapPoints ?? 0;

  const resultByRegistration = new Map(
    input.results.map((result) => [result.registrationId, result]),
  );

  const penaltiesByRegistration = new Map<
    string,
    { count: number; deducted: number }
  >();
  for (const penalty of input.penalties) {
    const bucket = penaltiesByRegistration.get(penalty.registrationId) ?? {
      count: 0,
      deducted: 0,
    };
    bucket.count += 1;
    if (
      penaltyCountsAgainstPoints(penalty.status) &&
      penalty.pointsDeducted &&
      penalty.pointsDeducted > 0
    ) {
      bucket.deducted += penalty.pointsDeducted;
    }
    penaltiesByRegistration.set(penalty.registrationId, bucket);
  }

  // Entries in scope: optionally narrowed to one class.
  const inScope =
    input.seriesClassId === undefined
      ? input.entries
      : input.entries.filter(
          (entry) => entry.seriesClassId === input.seriesClassId,
        );

  // A round can contribute to several competitors on a drivers' table, since
  // an endurance entry has a whole crew scoring the same result.
  const byCompetitor = new Map<
    string,
    { label: string; teamId: string | null; rounds: RoundScore[] }
  >();

  for (const entry of inScope) {
    const result = resultByRegistration.get(entry.registrationId);
    if (!result) continue;

    const penalties = penaltiesByRegistration.get(entry.registrationId) ?? {
      count: 0,
      deducted: 0,
    };
    const multiplier = entry.pointsMultiplier ?? 1;
    const gross =
      pointsForResult(result, config.scheme, fastestLapPoints) * multiplier;
    const round: RoundScore = {
      eventId: entry.eventId,
      registrationId: entry.registrationId,
      grossPoints: gross,
      pointsDeducted: penalties.deducted,
      // A deduction can zero a round out but never push it negative.
      netPoints: Math.max(0, gross - penalties.deducted),
      started: result.status !== ResultStatus.DNS,
      finishPosition:
        result.status === ResultStatus.FINISHED ? result.finishPosition : null,
      penaltyCount: penalties.count,
      counted: true,
    };

    for (const key of competitorKeys(entry, basis)) {
      const existing = byCompetitor.get(key.key) ?? {
        label: key.label,
        teamId: entry.teamId,
        rounds: [],
      };
      existing.rounds.push({ ...round });
      byCompetitor.set(key.key, existing);
    }
  }

  const rows: StandingsRow[] = [];
  for (const [key, value] of byCompetitor) {
    const label = input.labels?.[key] ?? value.label;
    rows.push(
      aggregate(key, label, value.teamId, value.rounds, config),
    );
  }

  return rows.sort(compareStandings);
}

/** Which competitor(s) a round's points belong to, for the requested basis. */
function competitorKeys(
  entry: StandingsEntry,
  basis: StandingsBasis,
): { key: string; label: string }[] {
  if (basis === "team") {
    // Individual entries have no team and simply do not appear.
    return entry.teamId
      ? [{ key: entry.teamId, label: entry.competitorLabel }]
      : [];
  }
  if (basis === "driver") {
    const drivers = entry.driverIds ?? [];
    return drivers.map((driverId) => ({
      key: driverId,
      label: entry.competitorLabel,
    }));
  }
  return [{ key: entry.competitorKey, label: entry.competitorLabel }];
}

/** Folds a competitor's rounds into a table row, applying drop scores. */
function aggregate(
  competitorKey: string,
  competitorLabel: string,
  teamId: string | null,
  rounds: RoundScore[],
  config: ChampionshipConfig,
): StandingsRow {
  // Drop the weakest rounds by net points. Ties are broken by keeping the
  // better finishing position, so dropping never costs a competitor a win.
  const ordered = [...rounds].sort((a, b) => {
    if (b.netPoints !== a.netPoints) return b.netPoints - a.netPoints;
    const aPos = a.finishPosition ?? Number.MAX_SAFE_INTEGER;
    const bPos = b.finishPosition ?? Number.MAX_SAFE_INTEGER;
    return aPos - bPos;
  });

  const limit = config.countBestRounds ?? null;
  if (limit !== null && ordered.length > limit) {
    for (let i = limit; i < ordered.length; i++) ordered[i].counted = false;
  }

  const counted = ordered.filter((round) => round.counted);

  let wins = 0;
  let podiums = 0;
  let bestFinish: number | null = null;
  let grossPoints = 0;
  let pointsDeducted = 0;
  let points = 0;

  for (const round of counted) {
    grossPoints += round.grossPoints;
    pointsDeducted += round.pointsDeducted;
    points += round.netPoints;
  }

  // Starts and results counts come from every round, not just the counted
  // ones — dropping a score for points does not undo the race.
  let starts = 0;
  let penaltyCount = 0;
  for (const round of rounds) {
    if (round.started) starts += 1;
    penaltyCount += round.penaltyCount;
    if (round.finishPosition !== null) {
      if (round.finishPosition === 1) wins += 1;
      if (round.finishPosition <= 3) podiums += 1;
      if (bestFinish === null || round.finishPosition < bestFinish) {
        bestFinish = round.finishPosition;
      }
    }
  }

  const minStarts = config.minStartsForTitle ?? null;
  return {
    competitorKey,
    competitorLabel,
    teamId,
    starts,
    wins,
    podiums,
    bestFinish,
    grossPoints,
    pointsDeducted,
    points,
    penaltyCount,
    droppedRounds: rounds.length - counted.length,
    titleEligible: minStarts === null || starts >= minStarts,
    // Chronological is how a season reads back.
    rounds: [...rounds].sort((a, b) =>
      a.eventId.localeCompare(b.eventId),
    ),
  };
}

/**
 * Points, then wins, then podiums, then best finish, then name.
 *
 * Title-ineligible competitors sort below eligible ones regardless of points,
 * so the table reads as the championship order rather than a points list.
 */
function compareStandings(a: StandingsRow, b: StandingsRow): number {
  if (a.titleEligible !== b.titleEligible) return a.titleEligible ? -1 : 1;
  if (b.points !== a.points) return b.points - a.points;
  if (b.wins !== a.wins) return b.wins - a.wins;
  if (b.podiums !== a.podiums) return b.podiums - a.podiums;
  const aBest = a.bestFinish ?? Number.MAX_SAFE_INTEGER;
  const bBest = b.bestFinish ?? Number.MAX_SAFE_INTEGER;
  if (aBest !== bBest) return aBest - bBest;
  return a.competitorLabel.localeCompare(b.competitorLabel);
}
