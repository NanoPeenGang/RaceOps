import { describe, expect, it } from "vitest";
import { TrackState, WeatherKind } from "@prisma/client";
import {
  currentConditions,
  describeConditions,
  formatTemp,
  isWetState,
  sessionWasWet,
  trackStateChanges,
  type ConditionReading,
} from "@/lib/conditions";

function reading(
  minutes: number,
  trackState: TrackState,
  extra: Partial<ConditionReading> = {},
): ConditionReading {
  return {
    recordedAt: new Date(2026, 5, 1, 12, minutes),
    trackState,
    ...extra,
  };
}

describe("isWetState", () => {
  it("treats damp as wet — a damp track has no dry line", () => {
    expect(isWetState(TrackState.DAMP)).toBe(true);
    expect(isWetState(TrackState.WET)).toBe(true);
    expect(isWetState(TrackState.STANDING_WATER)).toBe(true);
    expect(isWetState(TrackState.SNOW_ICE)).toBe(true);
    expect(isWetState(TrackState.DRY)).toBe(false);
  });
});

describe("currentConditions", () => {
  it("returns the most recent reading regardless of input order", () => {
    const latest = currentConditions([
      reading(30, TrackState.WET),
      reading(5, TrackState.DRY),
      reading(20, TrackState.DAMP),
    ]);
    expect(latest?.trackState).toBe(TrackState.WET);
  });

  it("returns null with nothing logged", () => {
    expect(currentConditions([])).toBeNull();
  });
});

describe("sessionWasWet", () => {
  it("is wet if any reading was wet, however it started", () => {
    expect(
      sessionWasWet([
        reading(0, TrackState.DRY),
        reading(60, TrackState.STANDING_WATER),
      ]),
    ).toBe(true);
  });

  it("is dry only when every reading was dry", () => {
    expect(
      sessionWasWet([reading(0, TrackState.DRY), reading(60, TrackState.DRY)]),
    ).toBe(false);
  });

  it("is null when nothing was logged — not the same as dry", () => {
    expect(sessionWasWet([])).toBeNull();
  });
});

describe("describeConditions", () => {
  it("reads track state, temperatures then weather", () => {
    expect(
      describeConditions(
        reading(0, TrackState.DRY, {
          airTempC: 24,
          trackTempC: 41.5,
          weather: WeatherKind.CLEAR,
        }),
      ),
    ).toBe("Dry · 24°C air / 41.5°C track · Clear");
  });

  it("drops the parts that were not recorded", () => {
    expect(describeConditions(reading(0, TrackState.WET))).toBe("Wet");
    expect(
      describeConditions(reading(0, TrackState.DAMP, { airTempC: 9 })),
    ).toBe("Damp · 9°C air");
  });

  it("keeps a zero temperature rather than dropping it as falsy", () => {
    expect(describeConditions(reading(0, TrackState.SNOW_ICE, { airTempC: 0 })))
      .toBe("Snow / ice · 0°C air");
  });

  it("returns null with no reading", () => {
    expect(describeConditions(null)).toBeNull();
  });
});

describe("formatTemp", () => {
  it("uses whole degrees where it can", () => {
    expect(formatTemp(24)).toBe("24°C");
    expect(formatTemp(41.47)).toBe("41.5°C");
    expect(formatTemp(-3)).toBe("-3°C");
  });
});

describe("trackStateChanges", () => {
  it("keeps the first reading and every change after it", () => {
    const changes = trackStateChanges([
      reading(0, TrackState.DRY),
      reading(10, TrackState.DRY),
      reading(20, TrackState.DAMP),
      reading(30, TrackState.WET),
      reading(40, TrackState.WET),
      reading(50, TrackState.DAMP),
    ]);
    expect(changes.map((change) => change.trackState)).toEqual([
      TrackState.DRY,
      TrackState.DAMP,
      TrackState.WET,
      TrackState.DAMP,
    ]);
  });

  it("sorts before comparing, so out-of-order logging still reads right", () => {
    const changes = trackStateChanges([
      reading(30, TrackState.WET),
      reading(0, TrackState.DRY),
    ]);
    expect(changes.map((change) => change.trackState)).toEqual([
      TrackState.DRY,
      TrackState.WET,
    ]);
  });

  it("returns nothing for a session with no readings", () => {
    expect(trackStateChanges([])).toEqual([]);
  });
});
