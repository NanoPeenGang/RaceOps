/**
 * Pit Wall strategy calculators (ported into RaceOps — spec Phase 3).
 * Pure functions: usable standalone, shared by the strategy UI and tRPC.
 */

export interface FuelStrategyInput {
  /** Race length in minutes. */
  raceMinutes: number;
  /** Average lap time in seconds. */
  avgLapSeconds: number;
  /** Fuel burned per lap, litres. */
  fuelPerLapLitres: number;
  /** Tank capacity, litres. */
  tankCapacityLitres: number;
  /** Extra safety margin in laps of fuel (default 1). */
  marginLaps?: number;
}

export interface FuelStrategyResult {
  totalLaps: number;
  totalFuelLitres: number;
  stops: number;
  lapsPerStint: number;
  fuelPerStintLitres: number;
}

export function calculateFuelStrategy(
  input: FuelStrategyInput,
): FuelStrategyResult {
  const {
    raceMinutes,
    avgLapSeconds,
    fuelPerLapLitres,
    tankCapacityLitres,
    marginLaps = 1,
  } = input;

  if (raceMinutes <= 0 || avgLapSeconds <= 0) {
    throw new Error("Race length and lap time must be positive.");
  }
  if (fuelPerLapLitres <= 0 || tankCapacityLitres <= 0) {
    throw new Error("Fuel figures must be positive.");
  }
  if (fuelPerLapLitres > tankCapacityLitres) {
    throw new Error("Fuel per lap exceeds tank capacity.");
  }

  // Timed races run one additional lap once the leader crosses the line.
  const totalLaps = Math.ceil((raceMinutes * 60) / avgLapSeconds) + 1;
  const totalFuelLitres = (totalLaps + marginLaps) * fuelPerLapLitres;

  const lapsPerTank = Math.floor(tankCapacityLitres / fuelPerLapLitres);
  const stints = Math.ceil(totalLaps / lapsPerTank);
  const stops = Math.max(0, stints - 1);
  const lapsPerStint = Math.ceil(totalLaps / stints);
  const fuelPerStintLitres = Math.min(
    tankCapacityLitres,
    (lapsPerStint + marginLaps) * fuelPerLapLitres,
  );

  return {
    totalLaps,
    totalFuelLitres: round1(totalFuelLitres),
    stops,
    lapsPerStint,
    fuelPerStintLitres: round1(fuelPerStintLitres),
  };
}

export interface DriverRotationInput {
  raceMinutes: number;
  drivers: string[];
  /** Max continuous driving time per stint, minutes (regulatory or team rule). */
  maxStintMinutes: number;
}

export interface DriverStint {
  driver: string;
  startMinute: number;
  endMinute: number;
}

/** Even rotation across drivers, capped at maxStintMinutes per stint. */
export function planDriverRotation(
  input: DriverRotationInput,
): DriverStint[] {
  const { raceMinutes, drivers, maxStintMinutes } = input;
  if (drivers.length === 0) throw new Error("At least one driver is required.");
  if (raceMinutes <= 0 || maxStintMinutes <= 0) {
    throw new Error("Durations must be positive.");
  }

  const stintCount = Math.max(
    drivers.length,
    Math.ceil(raceMinutes / maxStintMinutes),
  );
  const stintLength = raceMinutes / stintCount;

  const stints: DriverStint[] = [];
  for (let i = 0; i < stintCount; i++) {
    stints.push({
      driver: drivers[i % drivers.length],
      startMinute: round1(i * stintLength),
      endMinute: round1((i + 1) * stintLength),
    });
  }
  return stints;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
