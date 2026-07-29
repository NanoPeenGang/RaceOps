import { describe, expect, it } from "vitest";
import { TimingStatus } from "@prisma/client";
import {
  fastestLapOf,
  formatGap,
  formatLapTime,
  lapsDown,
  parseLapTime,
  sortTimingRows,
  type TimingRow,
} from "@/lib/timing";

function row(overrides: Partial<TimingRow> & { registrationId: string }): TimingRow {
  return {
    position: null,
    lapsCompleted: 0,
    bestLapMs: null,
    lastLapMs: null,
    gapMs: null,
    status: TimingStatus.RUNNING,
    ...overrides,
  };
}

describe("formatGap", () => {
  it("shows a dash for the leader", () => {
    expect(formatGap(null)).toBe("—");
    expect(formatGap(0)).toBe("—");
  });

  it("formats a time gap to three decimals", () => {
    expect(formatGap(1234)).toBe("+1.234");
    expect(formatGap(60000)).toBe("+60.000");
  });

  it("prefers laps down over a time gap", () => {
    // Once a car is lapped the time gap is meaningless — boards show laps.
    expect(formatGap(1234, 2)).toBe("+2 laps");
    expect(formatGap(null, 1)).toBe("+1 lap");
  });
});

describe("lap time round trip", () => {
  it("formats and re-parses to the same value", () => {
    for (const ms of [999, 1000, 83456, 125_999, 3_599_999]) {
      expect(parseLapTime(formatLapTime(ms))).toBe(ms);
    }
  });
});

describe("sortTimingRows", () => {
  it("orders by explicit position when the feed provides one", () => {
    const rows = [
      row({ registrationId: "c", position: 3 }),
      row({ registrationId: "a", position: 1 }),
      row({ registrationId: "b", position: 2 }),
    ];
    expect(sortTimingRows(rows).map((r) => r.registrationId)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("puts positioned rows ahead of unpositioned ones", () => {
    const rows = [
      row({ registrationId: "unset", lapsCompleted: 40 }),
      row({ registrationId: "second", position: 2, lapsCompleted: 1 }),
    ];
    expect(sortTimingRows(rows).map((r) => r.registrationId)).toEqual([
      "second",
      "unset",
    ]);
  });

  it("falls back to laps completed, then best lap", () => {
    const rows = [
      row({ registrationId: "slow-lap", lapsCompleted: 10, bestLapMs: 90_000 }),
      row({ registrationId: "most-laps", lapsCompleted: 11 }),
      row({ registrationId: "fast-lap", lapsCompleted: 10, bestLapMs: 85_000 }),
    ];
    expect(sortTimingRows(rows).map((r) => r.registrationId)).toEqual([
      "most-laps",
      "fast-lap",
      "slow-lap",
    ]);
  });

  it("sorts rows with no times at all behind rows with a best lap", () => {
    const rows = [
      row({ registrationId: "no-time" }),
      row({ registrationId: "timed", bestLapMs: 95_000 }),
    ];
    expect(sortTimingRows(rows).map((r) => r.registrationId)).toEqual([
      "timed",
      "no-time",
    ]);
  });

  it("does not mutate the input", () => {
    const rows = [
      row({ registrationId: "b", position: 2 }),
      row({ registrationId: "a", position: 1 }),
    ];
    sortTimingRows(rows);
    expect(rows[0].registrationId).toBe("b");
  });
});

describe("lapsDown", () => {
  it("counts laps behind the leader", () => {
    const leader = row({ registrationId: "leader", lapsCompleted: 42 });
    expect(lapsDown(row({ registrationId: "x", lapsCompleted: 40 }), leader)).toBe(
      2,
    );
  });

  it("is zero on the lead lap and never negative", () => {
    const leader = row({ registrationId: "leader", lapsCompleted: 42 });
    expect(lapsDown(leader, leader)).toBe(0);
    expect(
      lapsDown(row({ registrationId: "ahead", lapsCompleted: 43 }), leader),
    ).toBe(0);
  });

  it("is zero with no leader", () => {
    expect(
      lapsDown(row({ registrationId: "x", lapsCompleted: 5 }), undefined),
    ).toBe(0);
  });
});

describe("fastestLapOf", () => {
  it("finds the quickest best lap", () => {
    const fastest = fastestLapOf([
      row({ registrationId: "a", bestLapMs: 90_000 }),
      row({ registrationId: "b", bestLapMs: 88_500 }),
      row({ registrationId: "c", bestLapMs: null }),
    ]);
    expect(fastest?.registrationId).toBe("b");
  });

  it("is null when nobody has set a time", () => {
    expect(
      fastestLapOf([row({ registrationId: "a" }), row({ registrationId: "b" })]),
    ).toBeNull();
  });
});
