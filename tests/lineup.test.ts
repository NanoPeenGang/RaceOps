import { describe, expect, it } from "vitest";
import { LineupRole } from "@prisma/client";
import {
  LINEUP_ROLE_LABELS,
  breaches,
  checkLineup,
  driveTimeByDriver,
  formatDriveTime,
  hasDriveTimeRules,
  stintMinutes,
  type LineupEntry,
  type StintRecord,
} from "@/lib/lineup";

const T0 = new Date("2026-06-14T12:00:00Z");
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60000);

function driver(id: string, role: LineupRole = LineupRole.DRIVER): LineupEntry {
  return { id, userId: `u_${id}`, role };
}

function stint(
  id: string,
  lineupDriverId: string | null,
  startMin: number,
  endMin: number | null,
): StintRecord {
  return {
    id,
    lineupDriverId,
    startedAt: at(startMin),
    endedAt: endMin === null ? null : at(endMin),
  };
}

describe("LINEUP_ROLE_LABELS", () => {
  it("labels every role", () => {
    for (const role of Object.values(LineupRole)) {
      expect(LINEUP_ROLE_LABELS[role], role).toBeTruthy();
    }
  });
});

describe("hasDriveTimeRules", () => {
  it("is false for a sprint event with no regulations set", () => {
    expect(hasDriveTimeRules({})).toBe(false);
    expect(
      hasDriveTimeRules({ maxStintMinutes: null, maxDriversPerEntry: null }),
    ).toBe(false);
  });

  it("is true as soon as one rule is set", () => {
    expect(hasDriveTimeRules({ maxStintMinutes: 65 })).toBe(true);
  });
});

describe("stintMinutes", () => {
  it("measures a closed stint", () => {
    expect(stintMinutes(stint("s1", "d1", 0, 62), at(200))).toBe(62);
  });

  it("measures an open stint to now, so a live board can warn early", () => {
    expect(stintMinutes(stint("s1", "d1", 0, null), at(45))).toBe(45);
  });

  it("never returns a negative duration", () => {
    // Clock skew or a mis-entered end time must not produce negative time.
    expect(stintMinutes(stint("s1", "d1", 30, 10), at(60))).toBe(0);
  });
});

describe("driveTimeByDriver", () => {
  it("sums stints per driver and tracks the longest", () => {
    const totals = driveTimeByDriver(
      [
        stint("s1", "d1", 0, 60),
        stint("s2", "d2", 60, 130),
        stint("s3", "d1", 130, 175),
      ],
      at(200),
    );
    expect(totals.get("d1")).toMatchObject({
      totalMinutes: 105,
      stintCount: 2,
      longestStintMinutes: 60,
      inCar: false,
    });
    expect(totals.get("d2")?.totalMinutes).toBe(70);
  });

  it("marks a driver currently in the car", () => {
    const totals = driveTimeByDriver([stint("s1", "d1", 0, null)], at(20));
    expect(totals.get("d1")).toMatchObject({ inCar: true, totalMinutes: 20 });
  });

  it("excludes stints whose driver left the line-up", () => {
    // The stint happened, but it can no longer be attributed to anyone.
    const totals = driveTimeByDriver([stint("s1", null, 0, 40)], at(60));
    expect(totals.size).toBe(0);
  });
});

describe("checkLineup — line-up size", () => {
  const rules = { minDriversPerEntry: 2, maxDriversPerEntry: 4 };

  it("flags too few declared drivers", () => {
    const found = checkLineup({ lineup: [driver("d1")], stints: [], rules });
    expect(found.map((v) => v.code)).toContain("TOO_FEW_DRIVERS");
  });

  it("flags too many declared drivers", () => {
    const found = checkLineup({
      lineup: ["d1", "d2", "d3", "d4", "d5"].map((id) => driver(id)),
      stints: [],
      rules,
    });
    expect(found.map((v) => v.code)).toContain("TOO_MANY_DRIVERS");
  });

  it("does not count a reserve toward the seat limit", () => {
    const found = checkLineup({
      lineup: [
        driver("d1"),
        driver("d2"),
        driver("d3"),
        driver("d4"),
        driver("d5", LineupRole.RESERVE),
      ],
      stints: [],
      rules,
    });
    expect(found.map((v) => v.code)).not.toContain("TOO_MANY_DRIVERS");
  });

  it("accepts a compliant line-up", () => {
    expect(
      checkLineup({
        lineup: [driver("d1", LineupRole.DRIVER_OF_RECORD), driver("d2")],
        stints: [],
        rules,
      }),
    ).toEqual([]);
  });

  it("rejects two drivers of record", () => {
    const found = checkLineup({
      lineup: [
        driver("d1", LineupRole.DRIVER_OF_RECORD),
        driver("d2", LineupRole.DRIVER_OF_RECORD),
      ],
      stints: [],
      rules,
    });
    expect(found.map((v) => v.code)).toContain("MULTIPLE_DRIVERS_OF_RECORD");
  });

  it("finds nothing when an event sets no line-up rules", () => {
    expect(
      checkLineup({ lineup: [driver("d1")], stints: [], rules: {} }),
    ).toEqual([]);
  });
});

describe("checkLineup — stint length", () => {
  it("flags a stint over the maximum", () => {
    const found = checkLineup({
      lineup: [driver("d1")],
      stints: [stint("s1", "d1", 0, 70)],
      rules: { maxStintMinutes: 65 },
      now: at(100),
    });
    expect(found.map((v) => v.code)).toContain("STINT_TOO_LONG");
    expect(found[0].lineupDriverId).toBe("d1");
  });

  it("catches an over-long stint while the driver is still out", () => {
    // The point of measuring an open stint to now: race control sees it live.
    const found = checkLineup({
      lineup: [driver("d1")],
      stints: [stint("s1", "d1", 0, null)],
      rules: { maxStintMinutes: 65 },
      now: at(70),
    });
    expect(found.map((v) => v.code)).toContain("STINT_TOO_LONG");
  });

  it("flags a short stint only once it has ended", () => {
    const rules = { minStintMinutes: 20 };
    const open = checkLineup({
      lineup: [driver("d1")],
      stints: [stint("s1", "d1", 0, null)],
      rules,
      now: at(5),
    });
    expect(open.map((v) => v.code)).not.toContain("STINT_TOO_SHORT");

    const closed = checkLineup({
      lineup: [driver("d1")],
      stints: [stint("s1", "d1", 0, 5)],
      rules,
      now: at(30),
    });
    expect(closed.map((v) => v.code)).toContain("STINT_TOO_SHORT");
  });
});

describe("checkLineup — total drive time", () => {
  it("flags a driver over their total allowance", () => {
    const found = checkLineup({
      lineup: [driver("d1"), driver("d2")],
      stints: [stint("s1", "d1", 0, 130), stint("s2", "d1", 140, 260)],
      rules: { maxDriveMinutesPerDriver: 240 },
      now: at(300),
    });
    const breach = found.find((v) => v.code === "DRIVE_TIME_EXCEEDED");
    expect(breach?.lineupDriverId).toBe("d1");
  });

  it("treats an unmet minimum as pending mid-race and a breach at the end", () => {
    const args = {
      lineup: [driver("d1"), driver("d2")],
      stints: [stint("s1", "d1", 0, 200)],
      rules: { minDriveMinutesPerDriver: 60 },
      now: at(210),
    };

    const midRace = checkLineup(args);
    const pending = midRace.find((v) => v.code === "DRIVE_TIME_NOT_MET");
    expect(pending?.severity).toBe("pending");
    // Nothing is actionable yet, so race control's breach list stays empty.
    expect(breaches(midRace)).toEqual([]);

    const afterRace = checkLineup({ ...args, sessionComplete: true });
    expect(
      breaches(afterRace).map((v) => v.code),
    ).toContain("DRIVE_TIME_NOT_MET");
  });

  it("accepts a compliant endurance line-up outright", () => {
    const found = checkLineup({
      lineup: [driver("d1", LineupRole.DRIVER_OF_RECORD), driver("d2")],
      stints: [
        stint("s1", "d1", 0, 60),
        stint("s2", "d2", 60, 120),
        stint("s3", "d1", 120, 180),
        stint("s4", "d2", 180, 240),
      ],
      rules: {
        minDriversPerEntry: 2,
        maxDriversPerEntry: 4,
        maxStintMinutes: 65,
        minStintMinutes: 20,
        maxDriveMinutesPerDriver: 150,
        minDriveMinutesPerDriver: 60,
      },
      sessionComplete: true,
      now: at(240),
    });
    expect(found).toEqual([]);
  });
});

describe("checkLineup — overlapping stints", () => {
  it("flags two drivers in the car at once", () => {
    const found = checkLineup({
      lineup: [driver("d1"), driver("d2")],
      stints: [stint("s1", "d1", 0, 60), stint("s2", "d2", 40, 90)],
      rules: {},
      now: at(100),
    });
    expect(found.map((v) => v.code)).toContain("OVERLAPPING_STINTS");
  });

  it("accepts back-to-back stints that touch", () => {
    const found = checkLineup({
      lineup: [driver("d1"), driver("d2")],
      stints: [stint("s1", "d1", 0, 60), stint("s2", "d2", 60, 120)],
      rules: {},
      now: at(130),
    });
    expect(found).toEqual([]);
  });

  it("flags a new stint started before the previous one was closed", () => {
    // The common data-entry error: forgetting to end a stint.
    const found = checkLineup({
      lineup: [driver("d1"), driver("d2")],
      stints: [stint("s1", "d1", 0, null), stint("s2", "d2", 60, 120)],
      rules: {},
      now: at(130),
    });
    expect(found.map((v) => v.code)).toContain("OVERLAPPING_STINTS");
  });
});

describe("formatDriveTime", () => {
  it("formats hours and minutes", () => {
    expect(formatDriveTime(134)).toBe("2h 14m");
    expect(formatDriveTime(45)).toBe("45m");
    expect(formatDriveTime(120)).toBe("2h 0m");
  });

  it("shows a dash for no time", () => {
    expect(formatDriveTime(null)).toBe("—");
    expect(formatDriveTime(undefined)).toBe("—");
    expect(formatDriveTime(0)).toBe("—");
  });
});
