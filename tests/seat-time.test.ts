import { describe, expect, it } from "vitest";
import {
  driversWithoutSeatTime,
  formatMinutes,
  seatTimeBalance,
  seatTimeByDriver,
} from "@/lib/seat-time";
import type { SeasonStint } from "@/lib/seat-time";

const NOW = new Date("2026-06-01T12:00:00Z");
const at = (iso: string) => new Date(iso);

const stint = (over: Partial<SeasonStint> & { id: string }): SeasonStint => ({
  registrationId: "reg1",
  lineupDriverId: "ld1",
  userId: "u1",
  eventId: "e1",
  eventName: "Sebring",
  eventDate: at("2026-03-01T00:00:00Z"),
  startedAt: at("2026-03-01T10:00:00Z"),
  endedAt: at("2026-03-01T11:00:00Z"),
  ...over,
});

describe("seatTimeByDriver", () => {
  it("totals minutes, stints and events per driver", () => {
    const summary = seatTimeByDriver(
      [
        stint({ id: "a" }),
        stint({
          id: "b",
          startedAt: at("2026-03-01T12:00:00Z"),
          endedAt: at("2026-03-01T12:30:00Z"),
        }),
        stint({
          id: "c",
          eventId: "e2",
          eventName: "VIR",
          eventDate: at("2026-04-01T00:00:00Z"),
          startedAt: at("2026-04-01T10:00:00Z"),
          endedAt: at("2026-04-01T11:00:00Z"),
        }),
      ],
      NOW,
    );

    expect(summary.drivers).toHaveLength(1);
    const driver = summary.drivers[0]!;
    expect(driver.totalMinutes).toBe(150);
    expect(driver.stintCount).toBe(3);
    expect(driver.eventCount).toBe(2);
    expect(driver.longestStintMinutes).toBe(60);
  });

  it("counts an open stint up to now, like the event view does", () => {
    // A driver currently in the car should not look as though they have done
    // nothing this weekend.
    const summary = seatTimeByDriver(
      [
        stint({
          id: "a",
          startedAt: new Date(NOW.getTime() - 30 * 60_000),
          endedAt: null,
        }),
      ],
      NOW,
    );
    expect(summary.drivers[0]!.totalMinutes).toBe(30);
    expect(summary.drivers[0]!.inCar).toBe(true);
  });

  it("sorts busiest first", () => {
    const summary = seatTimeByDriver(
      [
        stint({ id: "a", userId: "quiet", endedAt: at("2026-03-01T10:15:00Z") }),
        stint({ id: "b", userId: "busy" }),
      ],
      NOW,
    );
    expect(summary.drivers.map((driver) => driver.userId)).toEqual([
      "busy",
      "quiet",
    ]);
  });

  it("reports the last event each driver ran", () => {
    const summary = seatTimeByDriver(
      [
        stint({ id: "a" }),
        stint({
          id: "b",
          eventId: "e2",
          eventName: "VIR",
          eventDate: at("2026-04-01T00:00:00Z"),
          startedAt: at("2026-04-01T10:00:00Z"),
          endedAt: at("2026-04-01T10:30:00Z"),
        }),
      ],
      NOW,
    );
    expect(summary.drivers[0]!.lastEventName).toBe("VIR");
  });

  it("holds unattributed minutes apart rather than dropping or guessing", () => {
    // Those minutes happened and belong in the team's hours; attributing them
    // to somebody would be a guess.
    const summary = seatTimeByDriver(
      [stint({ id: "a" }), stint({ id: "b", userId: null, lineupDriverId: null })],
      NOW,
    );
    expect(summary.drivers).toHaveLength(1);
    expect(summary.unattributedMinutes).toBe(60);
    expect(summary.totalMinutes).toBe(120);
  });

  it("sums laps where a team tracks them", () => {
    const summary = seatTimeByDriver(
      [stint({ id: "a", laps: 24 }), stint({ id: "b", laps: 18 })],
      NOW,
    );
    expect(summary.drivers[0]!.laps).toBe(42);
  });
});

describe("seatTimeBalance", () => {
  const driver = (userId: string, totalMinutes: number) => ({
    userId,
    totalMinutes,
    stintCount: 1,
    eventCount: 1,
    longestStintMinutes: totalMinutes,
    laps: 0,
    lastEventName: null,
    lastEventDate: null,
    inCar: false,
  });

  it("is 1 for an even split", () => {
    expect(seatTimeBalance([driver("a", 60), driver("b", 60)])).toBe(1);
  });

  it("is 0 when one driver has it all", () => {
    expect(seatTimeBalance([driver("a", 120), driver("b", 0)])).toBe(0);
  });

  it("is somewhere between for an uneven one", () => {
    const balance = seatTimeBalance([driver("a", 90), driver("b", 30)])!;
    expect(balance).toBeGreaterThan(0);
    expect(balance).toBeLessThan(1);
  });

  it("is null for a solo entry rather than reporting 0", () => {
    // A single driver is not unbalanced, they are solo — 0 would read as a
    // problem to fix.
    expect(seatTimeBalance([driver("a", 60)])).toBeNull();
    expect(seatTimeBalance([])).toBeNull();
  });

  it("is null when nobody has been out at all", () => {
    expect(seatTimeBalance([driver("a", 0), driver("b", 0)])).toBeNull();
  });
});

describe("driversWithoutSeatTime", () => {
  it("finds the drivers a stint table cannot show", () => {
    // Somebody with zero stints does not appear in the seat-time map at all,
    // so "who is owed a run" is unanswerable without this.
    const drivers = [
      {
        userId: "ran",
        totalMinutes: 60,
        stintCount: 1,
        eventCount: 1,
        longestStintMinutes: 60,
        laps: 0,
        lastEventName: null,
        lastEventDate: null,
        inCar: false,
      },
    ];
    expect(driversWithoutSeatTime(["ran", "waiting"], drivers)).toEqual([
      "waiting",
    ]);
  });

  it("is empty when everyone has been out", () => {
    expect(driversWithoutSeatTime([], [])).toEqual([]);
  });
});

describe("formatMinutes", () => {
  it("reads the way a team says it", () => {
    expect(formatMinutes(38)).toBe("38m");
    expect(formatMinutes(60)).toBe("1h");
    expect(formatMinutes(252)).toBe("4h 12m");
  });
});
