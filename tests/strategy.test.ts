import { describe, expect, it } from "vitest";
import {
  calculateFuelStrategy,
  planDriverRotation,
} from "@/lib/strategy";

describe("calculateFuelStrategy", () => {
  it("computes laps, fuel and stops for a 60-minute GT3 race", () => {
    const result = calculateFuelStrategy({
      raceMinutes: 60,
      avgLapSeconds: 105,
      fuelPerLapLitres: 2.8,
      tankCapacityLitres: 104,
    });
    // 60*60/105 = 34.28 -> 35 laps + 1 leader lap = 36
    expect(result.totalLaps).toBe(36);
    // (36 + 1 margin) * 2.8
    expect(result.totalFuelLitres).toBeCloseTo(103.6, 1);
    // 37 laps of fuel fits one 104L tank (37.1 laps per tank)
    expect(result.stops).toBe(0);
  });

  it("splits a race into stints when fuel exceeds tank capacity", () => {
    const result = calculateFuelStrategy({
      raceMinutes: 120,
      avgLapSeconds: 100,
      fuelPerLapLitres: 3,
      tankCapacityLitres: 100,
    });
    // 73 laps, 33 laps per tank -> 3 stints, 2 stops
    expect(result.totalLaps).toBe(73);
    expect(result.stops).toBe(2);
    expect(result.lapsPerStint).toBe(25);
    expect(result.fuelPerStintLitres).toBeLessThanOrEqual(100);
  });

  it("rejects a fuel-per-lap larger than the tank", () => {
    expect(() =>
      calculateFuelStrategy({
        raceMinutes: 60,
        avgLapSeconds: 100,
        fuelPerLapLitres: 120,
        tankCapacityLitres: 100,
      }),
    ).toThrow(/tank capacity/i);
  });

  it("rejects non-positive race parameters", () => {
    expect(() =>
      calculateFuelStrategy({
        raceMinutes: 0,
        avgLapSeconds: 100,
        fuelPerLapLitres: 2,
        tankCapacityLitres: 100,
      }),
    ).toThrow(/positive/i);
  });
});

describe("planDriverRotation", () => {
  it("rotates drivers evenly across a 24h-style race", () => {
    const stints = planDriverRotation({
      raceMinutes: 360,
      drivers: ["Ana", "Ben", "Cal"],
      maxStintMinutes: 65,
    });
    // 360/65 = 5.5 -> 6 stints of 60 min each
    expect(stints).toHaveLength(6);
    expect(stints[0]).toEqual({ driver: "Ana", startMinute: 0, endMinute: 60 });
    expect(stints[5].endMinute).toBe(360);
    // Every stint respects the cap
    for (const stint of stints) {
      expect(stint.endMinute - stint.startMinute).toBeLessThanOrEqual(65);
    }
    // Rotation covers all drivers
    expect(new Set(stints.map((s) => s.driver))).toEqual(
      new Set(["Ana", "Ben", "Cal"]),
    );
  });

  it("gives every driver at least one stint even in short races", () => {
    const stints = planDriverRotation({
      raceMinutes: 30,
      drivers: ["Ana", "Ben"],
      maxStintMinutes: 60,
    });
    expect(stints).toHaveLength(2);
  });

  it("rejects an empty driver list", () => {
    expect(() =>
      planDriverRotation({ raceMinutes: 60, drivers: [], maxStintMinutes: 60 }),
    ).toThrow(/driver/i);
  });
});
