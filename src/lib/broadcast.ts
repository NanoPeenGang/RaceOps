import { FlagState, TimingStatus } from "@prisma/client";
import { formatGap, formatLapTime } from "@/lib/timing";

/**
 * Broadcast support: the stream overlay feed and the commentator pack.
 *
 * Both are cheap given live timing already exists, and both are highly
 * visible — a sim league's stream is the thing most people ever see of it.
 * The overlay shape is deliberately flat and pre-formatted: an overlay is
 * usually a browser source in OBS running someone's hand-written HTML, and
 * every formatting decision left to that layer is one it will get wrong.
 */

export interface OverlayRow {
  position: number;
  carNumber: string | null;
  /// Short enough for a lower-third; the full name is `entrant`.
  shortName: string;
  entrant: string;
  className: string | null;
  laps: number;
  /// Pre-formatted, because an overlay should not be doing time arithmetic.
  gap: string;
  lastLap: string;
  bestLap: string;
  status: TimingStatus;
  inPit: boolean;
  /// True for the fastest lap of the session so far.
  fastest: boolean;
}

export interface OverlayFeed {
  event: { id: string; name: string };
  session: {
    id: string;
    name: string;
    type: string;
    status: string;
    flag: FlagState;
  };
  conditions: string | null;
  rows: OverlayRow[];
  fastestLap: {
    carNumber: string | null;
    shortName: string;
    time: string;
  } | null;
  /// ISO timestamp so an overlay can show staleness if the feed stops.
  updatedAt: string;
}

/**
 * Trims an entrant name to something that fits a lower-third.
 *
 * Overlays have a fixed width and a full team name overflows it, so the trim
 * happens here rather than in CSS where it would silently clip mid-word.
 */
export function shortenName(name: string, maxLength = 18): string {
  const trimmed = name.trim();
  if (trimmed.length <= maxLength) return trimmed;
  const cut = trimmed.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > maxLength / 2 ? cut.slice(0, lastSpace) : cut).trim();
}

export interface OverlaySource {
  position: number | null;
  registrationId: string;
  carNumber: string | null;
  entrant: string;
  className: string | null;
  lapsCompleted: number;
  gapMs: number | null;
  lastLapMs: number | null;
  bestLapMs: number | null;
  status: TimingStatus;
}

export function buildOverlayRows(entries: OverlaySource[]): OverlayRow[] {
  const fastest = entries.reduce<OverlaySource | null>((best, entry) => {
    if (entry.bestLapMs === null) return best;
    if (!best || best.bestLapMs === null) return entry;
    return entry.bestLapMs < best.bestLapMs ? entry : best;
  }, null);

  return entries.map((entry, index) => ({
    position: entry.position ?? index + 1,
    carNumber: entry.carNumber,
    shortName: shortenName(entry.entrant),
    entrant: entry.entrant,
    className: entry.className,
    laps: entry.lapsCompleted,
    gap:
      index === 0
        ? "Leader"
        : formatGap(
            entry.gapMs,
            Math.max(
              0,
              (entries[0]?.lapsCompleted ?? 0) - entry.lapsCompleted,
            ),
          ),
    lastLap: formatLapTime(entry.lastLapMs),
    bestLap: formatLapTime(entry.bestLapMs),
    status: entry.status,
    inPit: entry.status === TimingStatus.PIT,
    fastest:
      fastest !== null && entry.registrationId === fastest.registrationId,
  }));
}

// ---------------------------------------------------------------------------
// Commentator pack
// ---------------------------------------------------------------------------

export interface CommentatorEntry {
  carNumber: string | null;
  entrant: string;
  className: string | null;
  drivers: string[];
  car: string | null;
  /// Championship position going into this round, when there is a table.
  championshipPosition: number | null;
  championshipPoints: number | null;
  /// Points behind the championship leader; null for the leader.
  pointsBehindLeader: number | null;
  /// Season record so far, for the "worth knowing" line.
  starts: number;
  wins: number;
  podiums: number;
  /// Penalties on the public record this season — a fair thing to mention.
  penaltyCount: number;
  /**
   * Whether the title is still mathematically available to them. Null when
   * the maximum remaining score cannot be worked out (no points scheme, or
   * an unscheduled season).
   */
  titleStillPossible: boolean | null;
}

export interface CommentatorPack {
  event: { id: string; name: string; date: Date; venue: string | null };
  series: { name: string; roundsRemaining: number } | null;
  entries: CommentatorEntry[];
  /// The lines worth reading out: close title fights, streaks, milestones.
  talkingPoints: string[];
}

export interface StandingsForPack {
  competitorKey: string;
  competitorLabel: string;
  points: number;
  starts: number;
  wins: number;
  podiums: number;
  penaltyCount: number;
  titleEligible: boolean;
}

/**
 * Whether a competitor can still catch the leader.
 *
 * The honest version of the question a commentator asks. Deliberately
 * generous: it assumes maximum score in every remaining round and ignores
 * dropped scores, so it never tells a broadcast someone is out when they are
 * not. Being wrong the other way is a much smaller sin.
 */
export function titleStillPossible(
  points: number,
  leaderPoints: number,
  roundsRemaining: number,
  maxPointsPerRound: number,
): boolean {
  return points + roundsRemaining * maxPointsPerRound >= leaderPoints;
}

/** Highest score available in one round under a points scheme. */
export function maxRoundPoints(
  scheme: Record<number, number>,
  fastestLapPoints = 0,
): number {
  const best = Math.max(0, ...Object.values(scheme));
  return best + fastestLapPoints;
}

/**
 * Lines a commentator can read out.
 *
 * Generated conservatively — a talking point that turns out to be wrong on
 * air is worse than one that was never offered — so every line here is a
 * direct statement of something in the standings rather than an inference.
 */
export function talkingPoints(
  rows: StandingsForPack[],
  roundsRemaining: number,
  maxPointsPerRound: number,
): string[] {
  const points: string[] = [];
  const [leader, second, third] = rows;
  if (!leader) return points;

  if (second) {
    const gap = leader.points - second.points;
    points.push(
      gap === 0
        ? `${leader.competitorLabel} and ${second.competitorLabel} are level on points at the top.`
        : `${leader.competitorLabel} leads ${second.competitorLabel} by ${gap} point${gap === 1 ? "" : "s"}.`,
    );
  }

  if (roundsRemaining > 0 && maxPointsPerRound > 0) {
    const contenders = rows.filter(
      (row) =>
        row.titleEligible &&
        titleStillPossible(
          row.points,
          leader.points,
          roundsRemaining,
          maxPointsPerRound,
        ),
    );
    points.push(
      contenders.length === 1
        ? `${leader.competitorLabel} can wrap up the title with ${roundsRemaining} round${roundsRemaining === 1 ? "" : "s"} to go.`
        : `${contenders.length} competitors are still mathematically in the title fight with ${roundsRemaining} round${roundsRemaining === 1 ? "" : "s"} remaining.`,
    );
  }

  const mostWins = [...rows].sort((a, b) => b.wins - a.wins)[0];
  if (mostWins && mostWins.wins > 0 && mostWins.competitorKey !== leader.competitorKey) {
    points.push(
      `${mostWins.competitorLabel} has the most wins this season (${mostWins.wins}) but sits behind on points.`,
    );
  }

  if (third && third.points === second?.points) {
    points.push(
      `${second.competitorLabel} and ${third.competitorLabel} are tied for second.`,
    );
  }

  const winless = rows.filter((row) => row.starts >= 3 && row.wins === 0);
  if (winless.length > 0 && winless.length < rows.length) {
    const closest = winless.find((row) => row.podiums > 0);
    if (closest) {
      points.push(
        `${closest.competitorLabel} is still looking for a first win, with ${closest.podiums} podium${closest.podiums === 1 ? "" : "s"} so far.`,
      );
    }
  }

  return points;
}
