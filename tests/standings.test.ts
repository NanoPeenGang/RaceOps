import { describe, expect, it } from "vitest";
import { PenaltyStatus, ResultStatus } from "@prisma/client";
import {
  DEFAULT_POINTS_SCHEME,
  computeStandings,
  parsePointsScheme,
  penaltyCountsAgainstPoints,
  pointsForResult,
} from "@/lib/standings";

const scheme = DEFAULT_POINTS_SCHEME;

function result(
  registrationId: string,
  finishPosition: number | null,
  overrides: Partial<Parameters<typeof pointsForResult>[0]> = {},
) {
  return {
    registrationId,
    finishPosition,
    status: ResultStatus.FINISHED,
    fastestLap: false,
    pointsOverride: null,
    ...overrides,
  };
}

describe("parsePointsScheme", () => {
  it("falls back to the default for junk input", () => {
    expect(parsePointsScheme(null)).toEqual(DEFAULT_POINTS_SCHEME);
    expect(parsePointsScheme("nope")).toEqual(DEFAULT_POINTS_SCHEME);
    expect(parsePointsScheme([1, 2, 3])).toEqual(DEFAULT_POINTS_SCHEME);
    expect(parsePointsScheme({})).toEqual(DEFAULT_POINTS_SCHEME);
  });

  it("accepts a custom scheme", () => {
    expect(parsePointsScheme({ "1": 10, "2": 6 })).toEqual({ 1: 10, 2: 6 });
  });

  it("drops invalid entries rather than throwing", () => {
    // One bad value must not take down the standings page.
    expect(
      parsePointsScheme({ "1": 10, "0": 5, "-2": 4, abc: 3, "3": -1, "4": 2 }),
    ).toEqual({ 1: 10, 4: 2 });
  });
});

describe("pointsForResult", () => {
  it("scores by finishing position", () => {
    expect(pointsForResult(result("r", 1), scheme)).toBe(25);
    expect(pointsForResult(result("r", 10), scheme)).toBe(1);
  });

  it("scores nothing outside the points positions", () => {
    expect(pointsForResult(result("r", 11), scheme)).toBe(0);
  });

  it("adds the fastest-lap bonus only when the series awards one", () => {
    expect(pointsForResult(result("r", 1, { fastestLap: true }), scheme)).toBe(25);
    expect(pointsForResult(result("r", 1, { fastestLap: true }), scheme, 1)).toBe(
      26,
    );
  });

  it("awards nothing for DNF, DNS or DSQ — fastest lap included", () => {
    for (const status of [ResultStatus.DNF, ResultStatus.DNS, ResultStatus.DSQ]) {
      expect(
        pointsForResult(
          result("r", 1, { status, fastestLap: true }),
          scheme,
          5,
        ),
      ).toBe(0);
    }
  });

  it("honours a manual override", () => {
    expect(pointsForResult(result("r", 20, { pointsOverride: 7 }), scheme)).toBe(
      7,
    );
    // Overrides apply even to a DNF (e.g. half points for a stopped race).
    expect(
      pointsForResult(
        result("r", null, { status: ResultStatus.DNF, pointsOverride: 3 }),
        scheme,
      ),
    ).toBe(3);
  });
});

describe("penaltyCountsAgainstPoints", () => {
  it("counts a penalty that still stands, including under appeal", () => {
    expect(penaltyCountsAgainstPoints(PenaltyStatus.ISSUED)).toBe(true);
    expect(penaltyCountsAgainstPoints(PenaltyStatus.UNDER_APPEAL)).toBe(true);
    expect(penaltyCountsAgainstPoints(PenaltyStatus.UPHELD)).toBe(true);
    expect(penaltyCountsAgainstPoints(PenaltyStatus.REDUCED)).toBe(true);
  });

  it("stops counting once overturned", () => {
    expect(penaltyCountsAgainstPoints(PenaltyStatus.OVERTURNED)).toBe(false);
  });
});

describe("computeStandings", () => {
  const entries = [
    {
      registrationId: "reg1",
      competitorKey: "teamA",
      competitorLabel: "Team A",
      teamId: "teamA",
    },
    {
      registrationId: "reg2",
      competitorKey: "teamB",
      competitorLabel: "Team B",
      teamId: "teamB",
    },
  ];

  it("ranks by points", () => {
    const rows = computeStandings({
      entries,
      results: [result("reg1", 2), result("reg2", 1)],
      penalties: [],
      scheme,
    });
    expect(rows.map((r) => r.competitorKey)).toEqual(["teamB", "teamA"]);
    expect(rows[0].points).toBe(25);
    expect(rows[1].points).toBe(18);
  });

  it("aggregates a competitor across several rounds", () => {
    const rows = computeStandings({
      entries: [
        ...entries,
        {
          registrationId: "reg3",
          competitorKey: "teamA",
          competitorLabel: "Team A",
          teamId: "teamA",
        },
      ],
      results: [result("reg1", 1), result("reg2", 2), result("reg3", 1)],
      penalties: [],
      scheme,
    });
    const teamA = rows.find((r) => r.competitorKey === "teamA")!;
    expect(teamA.points).toBe(50);
    expect(teamA.wins).toBe(2);
    expect(teamA.starts).toBe(2);
  });

  it("subtracts points for a penalty that stands", () => {
    const rows = computeStandings({
      entries,
      results: [result("reg1", 1), result("reg2", 2)],
      penalties: [
        {
          registrationId: "reg1",
          status: PenaltyStatus.UPHELD,
          pointsDeducted: 10,
        },
      ],
      scheme,
    });
    const teamA = rows.find((r) => r.competitorKey === "teamA")!;
    expect(teamA.grossPoints).toBe(25);
    expect(teamA.pointsDeducted).toBe(10);
    expect(teamA.points).toBe(15);
    expect(teamA.penaltyCount).toBe(1);
    // The deduction drops Team A below Team B's 18.
    expect(rows[0].competitorKey).toBe("teamB");
  });

  it("restores points when a penalty is overturned", () => {
    const rows = computeStandings({
      entries,
      results: [result("reg1", 1), result("reg2", 2)],
      penalties: [
        {
          registrationId: "reg1",
          status: PenaltyStatus.OVERTURNED,
          pointsDeducted: 10,
        },
      ],
      scheme,
    });
    const teamA = rows.find((r) => r.competitorKey === "teamA")!;
    expect(teamA.points).toBe(25);
    expect(teamA.pointsDeducted).toBe(0);
    // Still shown on the record even though it no longer costs points.
    expect(teamA.penaltyCount).toBe(1);
  });

  it("never pushes a competitor below zero", () => {
    const rows = computeStandings({
      entries,
      results: [result("reg1", 10)],
      penalties: [
        {
          registrationId: "reg1",
          status: PenaltyStatus.ISSUED,
          pointsDeducted: 50,
        },
      ],
      scheme,
    });
    expect(rows.find((r) => r.competitorKey === "teamA")!.points).toBe(0);
  });

  it("breaks a points tie on wins, then podiums, then best finish", () => {
    const tie = [
      {
        registrationId: "x",
        competitorKey: "x",
        competitorLabel: "X",
        teamId: null,
      },
      {
        registrationId: "y",
        competitorKey: "y",
        competitorLabel: "Y",
        teamId: null,
      },
    ];
    // Both score 25: X from one win, Y from 2nd+4th (18+12=30) — adjust so
    // they are equal via an override.
    const rows = computeStandings({
      entries: tie,
      results: [
        result("x", 1),
        result("y", 4, { pointsOverride: 25 }),
      ],
      penalties: [],
      scheme,
    });
    expect(rows[0].competitorKey).toBe("x");
    expect(rows[0].wins).toBe(1);
  });

  it("counts a DNF as a start but not a finish", () => {
    const rows = computeStandings({
      entries: [entries[0]],
      results: [result("reg1", null, { status: ResultStatus.DNF })],
      penalties: [],
      scheme,
    });
    expect(rows[0].starts).toBe(1);
    expect(rows[0].bestFinish).toBeNull();
    expect(rows[0].points).toBe(0);
  });

  it("does not count a DNS as a start", () => {
    const rows = computeStandings({
      entries: [entries[0]],
      results: [result("reg1", null, { status: ResultStatus.DNS })],
      penalties: [],
      scheme,
    });
    expect(rows[0].starts).toBe(0);
  });

  it("lists an entry with no result yet on zero points", () => {
    const rows = computeStandings({
      entries,
      results: [],
      penalties: [],
      scheme,
    });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.points === 0 && r.starts === 0)).toBe(true);
  });

  it("ignores penalties against entries outside the series", () => {
    const rows = computeStandings({
      entries: [entries[0]],
      results: [result("reg1", 1)],
      penalties: [
        {
          registrationId: "unknown",
          status: PenaltyStatus.UPHELD,
          pointsDeducted: 25,
        },
      ],
      scheme,
    });
    expect(rows[0].points).toBe(25);
  });
});
