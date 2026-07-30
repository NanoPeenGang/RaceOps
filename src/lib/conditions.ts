import { TrackState, WeatherKind } from "@prisma/client";

/**
 * Session conditions.
 *
 * Track state and weather are separate on purpose: a track can be damp under
 * a clear sky an hour after rain, and that is precisely the case tire
 * regulations, records validity and strategy reviews all turn on.
 */

export const TRACK_STATE_LABELS: Record<TrackState, string> = {
  DRY: "Dry",
  DAMP: "Damp",
  WET: "Wet",
  STANDING_WATER: "Standing water",
  SNOW_ICE: "Snow / ice",
};

export const WEATHER_LABELS: Record<WeatherKind, string> = {
  CLEAR: "Clear",
  CLOUDY: "Cloudy",
  OVERCAST: "Overcast",
  LIGHT_RAIN: "Light rain",
  HEAVY_RAIN: "Heavy rain",
  FOG: "Fog",
  SNOW: "Snow",
  WINDY: "Windy",
};

/**
 * Track states that count as wet for regulation purposes.
 *
 * `DAMP` is included: wet-tire rules and record validity both hang on whether
 * a dry line existed, and a damp track is one where it did not. A series that
 * wants a narrower rule filters on the raw state instead.
 */
export const WET_TRACK_STATES: TrackState[] = [
  TrackState.DAMP,
  TrackState.WET,
  TrackState.STANDING_WATER,
  TrackState.SNOW_ICE,
];

export function isWetState(state: TrackState): boolean {
  return WET_TRACK_STATES.includes(state);
}

export interface ConditionReading {
  recordedAt: Date;
  trackState: TrackState;
  weather?: WeatherKind | null;
  airTempC?: number | null;
  trackTempC?: number | null;
  humidityPct?: number | null;
  windKph?: number | null;
  windDirection?: string | null;
  notes?: string | null;
}

/** The most recent reading — a session's current conditions. */
export function currentConditions<T extends ConditionReading>(
  readings: T[],
): T | null {
  return readings.reduce<T | null>(
    (latest, reading) =>
      !latest || reading.recordedAt > latest.recordedAt ? reading : latest,
    null,
  );
}

/**
 * Whether a session was wet, for record validity.
 *
 * Any wet reading makes the whole session wet. A two-hour race that starts dry
 * and ends in standing water is not a dry session, and a record set in the
 * dry half of it would still be contested — the conservative answer is the
 * only one that survives a protest.
 *
 * Returns null when nothing was logged, which is not the same as dry: a
 * session with no readings should not have its laps thrown out.
 */
export function sessionWasWet(readings: ConditionReading[]): boolean | null {
  if (readings.length === 0) return null;
  return readings.some((reading) => isWetState(reading.trackState));
}

/** "Dry · 24°C air / 41°C track · Clear" for a header line. */
export function describeConditions(
  reading: ConditionReading | null,
): string | null {
  if (!reading) return null;
  const temps = [
    reading.airTempC !== null && reading.airTempC !== undefined
      ? `${formatTemp(reading.airTempC)} air`
      : null,
    reading.trackTempC !== null && reading.trackTempC !== undefined
      ? `${formatTemp(reading.trackTempC)} track`
      : null,
  ].filter(Boolean);

  return [
    TRACK_STATE_LABELS[reading.trackState],
    temps.length > 0 ? temps.join(" / ") : null,
    reading.weather ? WEATHER_LABELS[reading.weather] : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** One decimal at most; whole degrees read better than "24.0°C". */
export function formatTemp(celsius: number): string {
  const rounded = Math.round(celsius * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}°C`;
}

/**
 * Points in a session where the track state changed, for a strategy review.
 * The first reading always counts as a change: it is where the session began.
 */
export function trackStateChanges<T extends ConditionReading>(
  readings: T[],
): T[] {
  const ordered = [...readings].sort(
    (a, b) => a.recordedAt.getTime() - b.recordedAt.getTime(),
  );
  const changes: T[] = [];
  let previous: TrackState | null = null;
  for (const reading of ordered) {
    if (reading.trackState !== previous) {
      changes.push(reading);
      previous = reading.trackState;
    }
  }
  return changes;
}
