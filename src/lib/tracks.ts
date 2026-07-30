import { TrackDirection, TrackKind } from "@prisma/client";

/**
 * Track reference data: naming, turn references and lap records.
 *
 * A venue only becomes useful as data once it is one row rather than four
 * spellings. Everything here is pure so the same rules apply whether a turn
 * is being rendered on an incident report, a marshal's phone or a record page.
 */

export const TRACK_KIND_LABELS: Record<TrackKind, string> = {
  CIRCUIT: "Circuit",
  STREET: "Street course",
  RALLY_STAGE: "Rally stage",
  OVAL: "Oval",
  KART: "Kart track",
  AUTOCROSS: "Autocross / solo",
  OTHER: "Other",
};

export const TRACK_DIRECTION_LABELS: Record<TrackDirection, string> = {
  CLOCKWISE: "Clockwise",
  ANTICLOCKWISE: "Anticlockwise",
};

/** Longest name a turn may carry, matching the picker and the print sheets. */
export const MAX_TURN_NAME_LENGTH = 60;

export interface TurnLike {
  number: number;
  name?: string | null;
  sector?: number | null;
  marshalPost?: string | null;
}

/**
 * How a turn reads on a report: "Turn 7", or "Turn 7 (Eau Rouge)" when the
 * corner has a name. Both halves matter — the marshal says the name, the
 * steward reading it an hour later wants the number.
 */
export function turnLabel(turn: TurnLike): string {
  const base = `Turn ${turn.number}`;
  return turn.name ? `${base} (${turn.name})` : base;
}

/** Short form for a timing sheet column or a phone-width list. */
export function turnShortLabel(turn: TurnLike): string {
  return turn.name ?? `T${turn.number}`;
}

export interface LayoutLike {
  name: string;
  platform?: string | null;
  track?: { name: string } | null;
}

/**
 * Full venue name for headings and documents: "Spa-Francorchamps — Grand Prix",
 * with the sim appended when the layout is a sim version of a real circuit.
 */
export function layoutLabel(layout: LayoutLike): string {
  const track = layout.track?.name;
  const base = track ? `${track} — ${layout.name}` : layout.name;
  return layout.platform ? `${base} (${layout.platform})` : base;
}

/**
 * The venue string to show for an event. Prefers the linked layout and falls
 * back to the free-text field, which stays populated for one-off bookings and
 * for every event created before tracks existed.
 */
export function eventVenueLabel(event: {
  venue?: string | null;
  trackLayout?: (LayoutLike & { track?: { name: string } | null }) | null;
}): string | null {
  if (event.trackLayout) return layoutLabel(event.trackLayout);
  return event.venue?.trim() || null;
}

/** Lap length rendered in km to 3dp, the convention on entry lists. */
export function formatLength(meters: number | null | undefined): string | null {
  if (meters === null || meters === undefined || meters <= 0) return null;
  return `${(meters / 1000).toFixed(3)} km`;
}

/**
 * Groups turns by timing sector for the layout editor and the marshal view.
 * Turns with no sector are collected under `null` rather than dropped, because
 * a half-defined layout is the normal state of a club circuit's first season.
 */
export function turnsBySector<T extends TurnLike>(
  turns: T[],
): { sector: number | null; turns: T[] }[] {
  const buckets = new Map<number | null, T[]>();
  for (const turn of [...turns].sort((a, b) => a.number - b.number)) {
    const key = turn.sector ?? null;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(turn);
    else buckets.set(key, [turn]);
  }
  return [...buckets.entries()]
    .sort((a, b) => {
      if (a[0] === null) return 1;
      if (b[0] === null) return -1;
      return a[0] - b[0];
    })
    .map(([sector, grouped]) => ({ sector, turns: grouped }));
}

// ---------------------------------------------------------------------------
// Lap records
// ---------------------------------------------------------------------------

/**
 * A lap that might be a record. `wet` and `sessionType` are carried because a
 * record set in the wet, or in a practice session, is not the same record —
 * most regulations only recognise a race lap, and nobody wants their dry
 * record beaten by a mis-keyed wet time.
 */
export interface RecordLap {
  registrationId: string;
  competitorLabel: string;
  teamId: string | null;
  seriesClassId: string | null;
  seriesClassName: string | null;
  eventId: string;
  eventName: string;
  eventDate: Date;
  sessionId: string;
  sessionName: string;
  sessionType: string;
  lapMs: number;
  /// Null when the session logged no conditions, which is not the same as dry.
  wet: boolean | null;
}

export interface TrackRecord extends RecordLap {
  /// Which table this record heads: overall, or one class.
  seriesClassKey: string | null;
}

/** Session types whose laps count towards a record, per common regulation. */
export const RECORD_SESSION_TYPES = ["QUALIFYING", "RACE"] as const;

export interface RecordOptions {
  /**
   * Only count laps from sessions whose type is in this list. Defaults to
   * qualifying and race; a club that recognises practice laps can widen it.
   */
  sessionTypes?: readonly string[];
  /**
   * Exclude laps set in the wet. Laps from sessions with no logged conditions
   * are kept either way — refusing to rank them would erase every record set
   * before conditions were captured.
   */
  dryOnly?: boolean;
}

/** True when a lap is admissible under the given regulation options. */
export function lapCountsForRecord(
  lap: RecordLap,
  options: RecordOptions = {},
): boolean {
  if (lap.lapMs <= 0) return false;
  const types = options.sessionTypes ?? RECORD_SESSION_TYPES;
  if (!types.includes(lap.sessionType)) return false;
  if (options.dryOnly && lap.wet === true) return false;
  return true;
}

/**
 * Best admissible lap overall and per class.
 *
 * Classes are free-form records a series creates, so the per-class tables are
 * whatever classes actually appear in the laps — a grassroots meeting with
 * eighteen classes gets eighteen tables, and a single-grid series gets none.
 * Ties go to the earlier lap: the record belongs to whoever set it first.
 */
export function trackRecords(
  laps: RecordLap[],
  options: RecordOptions = {},
): { overall: TrackRecord | null; byClass: TrackRecord[] } {
  const admissible = laps.filter((lap) => lapCountsForRecord(lap, options));

  const best = (candidates: RecordLap[]): RecordLap | null =>
    candidates.reduce<RecordLap | null>((leader, lap) => {
      if (!leader) return lap;
      if (lap.lapMs < leader.lapMs) return lap;
      if (lap.lapMs === leader.lapMs && lap.eventDate < leader.eventDate) {
        return lap;
      }
      return leader;
    }, null);

  const overallLap = best(admissible);
  const overall: TrackRecord | null = overallLap
    ? { ...overallLap, seriesClassKey: null }
    : null;

  const classes = new Map<string, RecordLap[]>();
  for (const lap of admissible) {
    if (!lap.seriesClassId) continue;
    const bucket = classes.get(lap.seriesClassId);
    if (bucket) bucket.push(lap);
    else classes.set(lap.seriesClassId, [lap]);
  }

  const byClass: TrackRecord[] = [];
  for (const [seriesClassId, classLaps] of classes) {
    const leader = best(classLaps);
    if (leader) byClass.push({ ...leader, seriesClassKey: seriesClassId });
  }
  byClass.sort(
    (a, b) =>
      (a.seriesClassName ?? "").localeCompare(b.seriesClassName ?? "") ||
      a.lapMs - b.lapMs,
  );

  return { overall, byClass };
}
