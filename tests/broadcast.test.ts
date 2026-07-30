import { describe, expect, it } from "vitest";
import { TimingStatus } from "@prisma/client";
import {
  buildOverlayRows,
  maxRoundPoints,
  shortenName,
  talkingPoints,
  titleStillPossible,
  type OverlaySource,
  type StandingsForPack,
} from "@/lib/broadcast";

function entry(overrides: Partial<OverlaySource> = {}): OverlaySource {
  return {
    position: null,
    registrationId: "r1",
    carNumber: "1",
    entrant: "Apex Racing",
    className: null,
    lapsCompleted: 10,
    gapMs: null,
    lastLapMs: 90_000,
    bestLapMs: 90_000,
    status: TimingStatus.RUNNING,
    ...overrides,
  };
}

describe("shortenName", () => {
  it("leaves a short name alone", () => {
    expect(shortenName("Apex")).toBe("Apex");
  });

  it("cuts at a word boundary rather than mid-word", () => {
    expect(shortenName("Apex Motorsport Racing Team", 18)).toBe(
      "Apex Motorsport",
    );
  });

  it("hard-cuts a single long word rather than returning almost nothing", () => {
    expect(shortenName("Supercalifragilistic", 10)).toBe("Supercalif");
  });
});

describe("buildOverlayRows", () => {
  const entries = [
    entry({ registrationId: "a", carNumber: "1", bestLapMs: 90_000 }),
    entry({
      registrationId: "b",
      carNumber: "2",
      gapMs: 2_500,
      bestLapMs: 89_000,
      lapsCompleted: 10,
    }),
    entry({
      registrationId: "c",
      carNumber: "3",
      lapsCompleted: 9,
      bestLapMs: 95_000,
    }),
  ];

  it("pre-formats every value an overlay would otherwise compute", () => {
    const rows = buildOverlayRows(entries);
    expect(rows[0].gap).toBe("Leader");
    expect(rows[1].gap).toBe("+2.500");
    expect(rows[0].lastLap).toBe("1:30.000");
  });

  it("reports a car a lap down as laps rather than seconds", () => {
    const rows = buildOverlayRows(entries);
    expect(rows[2].gap).toBe("+1 lap");
  });

  it("marks the session's fastest lap wherever it sits in the order", () => {
    const rows = buildOverlayRows(entries);
    expect(rows.filter((row) => row.fastest)).toHaveLength(1);
    expect(rows.find((row) => row.fastest)?.carNumber).toBe("2");
  });

  it("falls back to the running order when positions are not set", () => {
    const rows = buildOverlayRows(entries);
    expect(rows.map((row) => row.position)).toEqual([1, 2, 3]);
  });

  it("uses an explicit position when the board has one", () => {
    const rows = buildOverlayRows([entry({ position: 4 })]);
    expect(rows[0].position).toBe(4);
  });

  it("flags a car in the pits", () => {
    const rows = buildOverlayRows([entry({ status: TimingStatus.PIT })]);
    expect(rows[0].inPit).toBe(true);
  });

  it("marks nothing fastest when nobody has set a lap", () => {
    const rows = buildOverlayRows([entry({ bestLapMs: null })]);
    expect(rows[0].fastest).toBe(false);
    expect(rows[0].bestLap).toBe("—");
  });
});

describe("titleStillPossible", () => {
  it("keeps a competitor in while the maths allows it", () => {
    expect(titleStillPossible(50, 100, 2, 25)).toBe(true);
    expect(titleStillPossible(50, 100, 2, 26)).toBe(true);
  });

  it("rules someone out only when it is arithmetically certain", () => {
    expect(titleStillPossible(50, 200, 2, 25)).toBe(false);
  });

  it("treats exactly catching the leader as still possible", () => {
    expect(titleStillPossible(75, 100, 1, 25)).toBe(true);
  });

  it("leaves the leader in with no rounds left", () => {
    expect(titleStillPossible(100, 100, 0, 25)).toBe(true);
  });
});

describe("maxRoundPoints", () => {
  it("takes the best position plus any fastest-lap bonus", () => {
    expect(maxRoundPoints({ 1: 25, 2: 18, 3: 15 }, 1)).toBe(26);
    expect(maxRoundPoints({ 1: 25 })).toBe(25);
  });

  it("copes with an empty scheme rather than returning -Infinity", () => {
    expect(maxRoundPoints({})).toBe(0);
  });
});

function row(overrides: Partial<StandingsForPack>): StandingsForPack {
  return {
    competitorKey: "k",
    competitorLabel: "Someone",
    points: 0,
    starts: 5,
    wins: 0,
    podiums: 0,
    penaltyCount: 0,
    titleEligible: true,
    ...overrides,
  };
}

describe("talkingPoints", () => {
  it("opens with the gap at the top", () => {
    const points = talkingPoints(
      [
        row({ competitorKey: "a", competitorLabel: "Alpha", points: 100 }),
        row({ competitorKey: "b", competitorLabel: "Beta", points: 88 }),
      ],
      2,
      25,
    );
    expect(points[0]).toBe("Alpha leads Beta by 12 points.");
  });

  it("says level rather than 'by 0 points'", () => {
    const points = talkingPoints(
      [
        row({ competitorKey: "a", competitorLabel: "Alpha", points: 100 }),
        row({ competitorKey: "b", competitorLabel: "Beta", points: 100 }),
      ],
      1,
      25,
    );
    expect(points[0]).toContain("level on points");
  });

  it("notes when the leader can clinch it", () => {
    const points = talkingPoints(
      [
        row({ competitorKey: "a", competitorLabel: "Alpha", points: 200 }),
        row({ competitorKey: "b", competitorLabel: "Beta", points: 10 }),
      ],
      1,
      25,
    );
    expect(points.some((line) => line.includes("wrap up the title"))).toBe(true);
  });

  it("counts the contenders when the fight is open", () => {
    const points = talkingPoints(
      [
        row({ competitorKey: "a", competitorLabel: "Alpha", points: 100 }),
        row({ competitorKey: "b", competitorLabel: "Beta", points: 95 }),
        row({ competitorKey: "c", competitorLabel: "Gamma", points: 90 }),
      ],
      3,
      25,
    );
    expect(
      points.some((line) => line.includes("3 competitors are still")),
    ).toBe(true);
  });

  it("mentions the most wins when they are not leading", () => {
    const points = talkingPoints(
      [
        row({ competitorKey: "a", competitorLabel: "Alpha", points: 100, wins: 1 }),
        row({ competitorKey: "b", competitorLabel: "Beta", points: 95, wins: 4 }),
      ],
      1,
      25,
    );
    expect(points.some((line) => line.includes("most wins"))).toBe(true);
  });

  it("says nothing at all for an empty table", () => {
    expect(talkingPoints([], 3, 25)).toEqual([]);
  });

  it("does not claim a title fight when no points are on offer", () => {
    const points = talkingPoints(
      [
        row({ competitorKey: "a", competitorLabel: "Alpha", points: 10 }),
        row({ competitorKey: "b", competitorLabel: "Beta", points: 5 }),
      ],
      0,
      0,
    );
    expect(points.some((line) => line.includes("title"))).toBe(false);
  });
});
