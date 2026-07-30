import { describe, expect, it } from "vitest";
import { RegistrationStatus, SessionType } from "@prisma/client";
import {
  buildEntryList,
  buildGrid,
  buildTimetable,
  buildTimingSheet,
  compareCarNumbers,
  entryListByClass,
  formatSlot,
  type EntryListSource,
} from "@/lib/race-documents";

function registration(
  overrides: Partial<EntryListSource> & { id: string },
): EntryListSource {
  return {
    carNumber: null,
    carClass: null,
    status: RegistrationStatus.CONFIRMED,
    team: null,
    entrantUser: null,
    seriesClass: null,
    lineup: [],
    car: null,
    transponders: [],
    paddock: null,
    ...overrides,
  };
}

describe("compareCarNumbers", () => {
  it("sorts numerically, so 7 comes before 11", () => {
    const sorted = ["11", "7", "2"].sort(compareCarNumbers);
    expect(sorted).toEqual(["2", "7", "11"]);
  });

  it("keeps a suffixed number beside its base", () => {
    const sorted = ["8", "7B", "7", "7A"].sort(compareCarNumbers);
    expect(sorted).toEqual(["7", "7A", "7B", "8"]);
  });

  it("treats a leading zero as the same number", () => {
    expect(compareCarNumbers("07", "7")).toBe(0);
  });

  it("puts non-numeric numbers after numeric ones, and blanks last", () => {
    const sorted = [null, "MINI", "3"].sort(compareCarNumbers);
    expect(sorted).toEqual(["3", "MINI", null]);
  });
});

describe("buildEntryList", () => {
  it("includes only confirmed entries", () => {
    const rows = buildEntryList([
      registration({ id: "a", carNumber: "1" }),
      registration({
        id: "b",
        carNumber: "2",
        status: RegistrationStatus.WAITLISTED,
      }),
      registration({
        id: "c",
        carNumber: "3",
        status: RegistrationStatus.WITHDRAWN,
      }),
    ]);
    expect(rows.map((row) => row.registrationId)).toEqual(["a"]);
  });

  it("sorts by car number the way a paddock reads it", () => {
    const rows = buildEntryList([
      registration({ id: "a", carNumber: "11" }),
      registration({ id: "b", carNumber: "7" }),
    ]);
    expect(rows.map((row) => row.carNumber)).toEqual(["7", "11"]);
  });

  it("prefers the declared class over the free-text one", () => {
    const [row] = buildEntryList([
      registration({
        id: "a",
        carClass: "typed by hand",
        seriesClass: { name: "GT4", code: "GT4" },
      }),
    ]);
    expect(row.className).toBe("GT4");
  });

  it("keeps the free-text class for a series that declares none", () => {
    const [row] = buildEntryList([
      registration({ id: "a", carClass: "Improved Production" }),
    ]);
    expect(row.className).toBe("Improved Production");
    expect(row.classCode).toBeNull();
  });

  it("takes the primary transponder when an entry carries a backup", () => {
    const [row] = buildEntryList([
      registration({
        id: "a",
        transponders: [
          { isPrimary: false, transponder: { number: "BACKUP" } },
          { isPrimary: true, transponder: { number: "PRIMARY" } },
        ],
      }),
    ]);
    expect(row.transponder).toBe("PRIMARY");
  });

  it("falls back to any transponder when none is marked primary", () => {
    const [row] = buildEntryList([
      registration({
        id: "a",
        transponders: [{ isPrimary: false, transponder: { number: "ONLY" } }],
      }),
    ]);
    expect(row.transponder).toBe("ONLY");
  });

  it("names the team, or the individual entrant", () => {
    const rows = buildEntryList([
      registration({ id: "a", carNumber: "1", team: { name: "Apex" } }),
      registration({
        id: "b",
        carNumber: "2",
        entrantUser: { profile: { displayName: "Sam" } },
      }),
      registration({ id: "c", carNumber: "3" }),
    ]);
    expect(rows.map((row) => row.entrant)).toEqual(["Apex", "Sam", "Entry"]);
  });
});

describe("entryListByClass", () => {
  it("groups by class alphabetically and puts unclassed entries last", () => {
    const rows = buildEntryList([
      registration({ id: "a", carNumber: "1", carClass: "Novice" }),
      registration({ id: "b", carNumber: "2" }),
      registration({ id: "c", carNumber: "3", carClass: "GT4" }),
    ]);
    const groups = entryListByClass(rows);
    expect(groups.map((group) => group.className)).toEqual([
      "GT4",
      "Novice",
      null,
    ]);
  });

  it("keeps every entry", () => {
    const rows = buildEntryList([
      registration({ id: "a", carNumber: "1", carClass: "A" }),
      registration({ id: "b", carNumber: "2" }),
    ]);
    const total = entryListByClass(rows).reduce(
      (count, group) => count + group.rows.length,
      0,
    );
    expect(total).toBe(2);
  });
});

describe("buildTimetable", () => {
  const sessions = [
    {
      id: "b",
      type: SessionType.RACE,
      name: "Race",
      startsAt: new Date(2026, 5, 2, 14, 0),
      endsAt: new Date(2026, 5, 2, 15, 0),
      location: null,
    },
    {
      id: "a",
      type: SessionType.QUALIFYING,
      name: "Qualifying",
      startsAt: new Date(2026, 5, 1, 9, 0),
      endsAt: new Date(2026, 5, 1, 9, 45),
      location: "Pit lane",
    },
  ];

  it("orders by start time and computes duration in minutes", () => {
    const rows = buildTimetable(sessions);
    expect(rows.map((row) => row.sessionId)).toEqual(["a", "b"]);
    expect(rows[0].durationMinutes).toBe(45);
    expect(rows[1].durationMinutes).toBe(60);
  });

  it("reads as a slot with its duration", () => {
    const [qualifying] = buildTimetable(sessions);
    expect(formatSlot(qualifying)).toContain("(45 min)");
  });

  it("never reports a negative duration", () => {
    const [row] = buildTimetable([
      {
        id: "x",
        type: SessionType.PRACTICE,
        name: "Backwards",
        startsAt: new Date(2026, 5, 1, 10, 0),
        endsAt: new Date(2026, 5, 1, 9, 0),
        location: null,
      },
    ]);
    expect(row.durationMinutes).toBe(0);
  });
});

describe("buildGrid", () => {
  const entries = [
    {
      registrationId: "slow",
      carNumber: "3",
      entrant: "Slow",
      className: null,
      bestLapMs: 95_000,
      position: null,
    },
    {
      registrationId: "fast",
      carNumber: "1",
      entrant: "Fast",
      className: null,
      bestLapMs: 90_000,
      position: null,
    },
    {
      registrationId: "notime",
      carNumber: "2",
      entrant: "No time",
      className: null,
      bestLapMs: null,
      position: null,
    },
  ];

  it("orders by lap time and puts cars with no time at the back", () => {
    const grid = buildGrid(entries);
    expect(grid.map((row) => row.registrationId)).toEqual([
      "fast",
      "slow",
      "notime",
    ]);
    expect(grid[2].qualifyingTime).toBeNull();
  });

  it("keeps a car with no time on the sheet — it still starts", () => {
    expect(buildGrid(entries)).toHaveLength(3);
  });

  it("forms up two abreast by default", () => {
    const grid = buildGrid(entries);
    expect(grid[0]).toMatchObject({ gridRow: 1, side: "left" });
    expect(grid[1]).toMatchObject({ gridRow: 1, side: "right" });
    expect(grid[2]).toMatchObject({ gridRow: 2, side: "left" });
  });

  it("supports a wider grid for karting and club formations", () => {
    const grid = buildGrid(entries, 3);
    expect(grid.map((row) => row.gridRow)).toEqual([1, 1, 1]);
  });

  it("lets an explicit position override the lap time", () => {
    const grid = buildGrid([
      { ...entries[1], position: 2 },
      { ...entries[0], position: 1 },
    ]);
    expect(grid.map((row) => row.registrationId)).toEqual(["slow", "fast"]);
  });
});

describe("buildTimingSheet", () => {
  const entries = [
    {
      registrationId: "b",
      carNumber: "11",
      entrant: "Second",
      className: null,
      transponder: null,
    },
    {
      registrationId: "a",
      carNumber: "7",
      entrant: "First",
      className: null,
      transponder: "123",
    },
  ];

  it("reads by car number before anything has been timed", () => {
    const rows = buildTimingSheet(entries);
    expect(rows.map((row) => row.carNumber)).toEqual(["7", "11"]);
    expect(rows[0].position).toBeNull();
    expect(rows[0].bestLap).toBeNull();
  });

  it("reads in finishing order once positions exist", () => {
    const rows = buildTimingSheet([
      { ...entries[0], position: 1, bestLapMs: 90_000, lapsCompleted: 20 },
      { ...entries[1], position: 2, bestLapMs: 91_000, lapsCompleted: 20 },
    ]);
    expect(rows.map((row) => row.registrationId)).toEqual(["b", "a"]);
    expect(rows[0].bestLap).toBe("1:30.000");
  });

  it("sorts timed entries ahead of untimed ones in a part-filled sheet", () => {
    const rows = buildTimingSheet([
      { ...entries[0] },
      { ...entries[1], position: 1 },
    ]);
    expect(rows[0].registrationId).toBe("a");
  });
});
