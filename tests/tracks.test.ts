import { describe, expect, it } from "vitest";
import {
  eventVenueLabel,
  formatLength,
  lapCountsForRecord,
  layoutLabel,
  trackRecords,
  turnLabel,
  turnShortLabel,
  turnsBySector,
  type RecordLap,
} from "@/lib/tracks";

describe("turn labels", () => {
  it("names a corner when it has a name and numbers it either way", () => {
    expect(turnLabel({ number: 7, name: "Eau Rouge" })).toBe(
      "Turn 7 (Eau Rouge)",
    );
    expect(turnLabel({ number: 7 })).toBe("Turn 7");
  });

  it("prefers the name in short form, where space is tight", () => {
    expect(turnShortLabel({ number: 7, name: "Eau Rouge" })).toBe("Eau Rouge");
    expect(turnShortLabel({ number: 7 })).toBe("T7");
  });
});

describe("layout labels", () => {
  it("reads track then layout, with the sim appended", () => {
    expect(
      layoutLabel({ name: "Grand Prix", track: { name: "Spa" } }),
    ).toBe("Spa — Grand Prix");
    expect(
      layoutLabel({
        name: "Grand Prix",
        platform: "iRacing",
        track: { name: "Spa" },
      }),
    ).toBe("Spa — Grand Prix (iRacing)");
  });

  it("falls back to free-text venue for events with no linked layout", () => {
    expect(eventVenueLabel({ venue: "Someone's airfield" })).toBe(
      "Someone's airfield",
    );
    expect(
      eventVenueLabel({
        venue: "Spelled Wrong",
        trackLayout: { name: "Full", track: { name: "Brands Hatch" } },
      }),
    ).toBe("Brands Hatch — Full");
    expect(eventVenueLabel({ venue: "   " })).toBeNull();
    expect(eventVenueLabel({})).toBeNull();
  });
});

describe("formatLength", () => {
  it("renders km to three places and refuses nonsense", () => {
    expect(formatLength(7004)).toBe("7.004 km");
    expect(formatLength(0)).toBeNull();
    expect(formatLength(null)).toBeNull();
  });
});

describe("turnsBySector", () => {
  const turns = [
    { number: 3, sector: 2 },
    { number: 1, sector: 1 },
    { number: 4, sector: null },
    { number: 2, sector: 1 },
  ];

  it("groups by sector in order and keeps unassigned turns last", () => {
    const grouped = turnsBySector(turns);
    expect(grouped.map((group) => group.sector)).toEqual([1, 2, null]);
    expect(grouped[0].turns.map((turn) => turn.number)).toEqual([1, 2]);
    expect(grouped[2].turns.map((turn) => turn.number)).toEqual([4]);
  });

  it("keeps every turn — a half-defined layout is a normal state", () => {
    const total = turnsBySector(turns).reduce(
      (count, group) => count + group.turns.length,
      0,
    );
    expect(total).toBe(turns.length);
  });
});

// ---------------------------------------------------------------------------

function lap(overrides: Partial<RecordLap> & { lapMs: number }): RecordLap {
  return {
    registrationId: "reg",
    competitorLabel: "#1 Someone",
    teamId: null,
    seriesClassId: null,
    seriesClassName: null,
    eventId: "evt",
    eventName: "Round 1",
    eventDate: new Date("2026-03-01"),
    sessionId: "ses",
    sessionName: "Race",
    sessionType: "RACE",
    wet: null,
    ...overrides,
  };
}

describe("lapCountsForRecord", () => {
  it("admits qualifying and race laps by default", () => {
    expect(lapCountsForRecord(lap({ lapMs: 90_000 }))).toBe(true);
    expect(
      lapCountsForRecord(lap({ lapMs: 90_000, sessionType: "QUALIFYING" })),
    ).toBe(true);
    expect(
      lapCountsForRecord(lap({ lapMs: 90_000, sessionType: "PRACTICE" })),
    ).toBe(false);
  });

  it("lets a club widen the admissible session types", () => {
    expect(
      lapCountsForRecord(lap({ lapMs: 90_000, sessionType: "PRACTICE" }), {
        sessionTypes: ["PRACTICE", "RACE"],
      }),
    ).toBe(true);
  });

  it("drops wet laps under dryOnly but keeps laps with no conditions", () => {
    expect(
      lapCountsForRecord(lap({ lapMs: 90_000, wet: true }), { dryOnly: true }),
    ).toBe(false);
    expect(
      lapCountsForRecord(lap({ lapMs: 90_000, wet: null }), { dryOnly: true }),
    ).toBe(true);
    expect(
      lapCountsForRecord(lap({ lapMs: 90_000, wet: false }), { dryOnly: true }),
    ).toBe(true);
  });

  it("rejects a non-positive time", () => {
    expect(lapCountsForRecord(lap({ lapMs: 0 }))).toBe(false);
  });
});

describe("trackRecords", () => {
  it("finds the fastest admissible lap overall", () => {
    const { overall } = trackRecords([
      lap({ lapMs: 92_000, competitorLabel: "slower" }),
      lap({ lapMs: 89_500, competitorLabel: "fastest" }),
      lap({ lapMs: 80_000, competitorLabel: "practice", sessionType: "PRACTICE" }),
    ]);
    expect(overall?.competitorLabel).toBe("fastest");
    expect(overall?.seriesClassKey).toBeNull();
  });

  it("gives the record to whoever set the time first on a tie", () => {
    const { overall } = trackRecords([
      lap({
        lapMs: 90_000,
        competitorLabel: "later",
        eventDate: new Date("2026-06-01"),
      }),
      lap({
        lapMs: 90_000,
        competitorLabel: "first",
        eventDate: new Date("2026-02-01"),
      }),
    ]);
    expect(overall?.competitorLabel).toBe("first");
  });

  it("builds a table for every class that appears, however many that is", () => {
    const laps = [
      lap({ lapMs: 95_000, seriesClassId: "c1", seriesClassName: "ST-X" }),
      lap({ lapMs: 93_000, seriesClassId: "c1", seriesClassName: "ST-X" }),
      lap({ lapMs: 99_000, seriesClassId: "c2", seriesClassName: "Novice" }),
      lap({ lapMs: 88_000, seriesClassId: "c3", seriesClassName: "Improved Production" }),
    ];
    const { overall, byClass } = trackRecords(laps);
    expect(overall?.lapMs).toBe(88_000);
    expect(byClass).toHaveLength(3);
    expect(byClass.map((record) => record.seriesClassName)).toEqual([
      "Improved Production",
      "Novice",
      "ST-X",
    ]);
    expect(byClass.find((r) => r.seriesClassKey === "c1")?.lapMs).toBe(93_000);
  });

  it("produces no class tables for a single-grid series", () => {
    const { overall, byClass } = trackRecords([lap({ lapMs: 90_000 })]);
    expect(overall).not.toBeNull();
    expect(byClass).toEqual([]);
  });

  it("returns nothing when no lap is admissible", () => {
    const { overall, byClass } = trackRecords([
      lap({ lapMs: 90_000, sessionType: "PRACTICE" }),
    ]);
    expect(overall).toBeNull();
    expect(byClass).toEqual([]);
  });
});
