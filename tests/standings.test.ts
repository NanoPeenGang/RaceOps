import { describe, expect, it } from "vitest";
import { PenaltyStatus, ResultStatus } from "@prisma/client";
import {
  DEFAULT_POINTS_SCHEME,
  RESULT_STATUS_LABELS,
  computeStandings,
  parsePointsScheme,
  penaltyCountsAgainstPoints,
  pointsForResult,
  type StandingsEntry,
  type StandingsInput,
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

/** An entry in round `eventId` for a competitor, optionally in a class. */
function entry(
  registrationId: string,
  competitorKey: string,
  overrides: Partial<StandingsEntry> = {},
): StandingsEntry {
  return {
    registrationId,
    eventId: "e1",
    seriesClassId: null,
    teamId: competitorKey.startsWith("t_") ? competitorKey : null,
    competitorKey,
    competitorLabel: competitorKey,
    ...overrides,
  };
}

function run(input: Partial<StandingsInput> & Pick<StandingsInput, "entries">) {
  return computeStandings({
    results: [],
    penalties: [],
    config: { scheme },
    ...input,
  });
}

describe("RESULT_STATUS_LABELS", () => {
  it("labels every result status", () => {
    for (const status of Object.values(ResultStatus)) {
      expect(RESULT_STATUS_LABELS[status], status).toBeTruthy();
    }
  });
});

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
    expect(parsePointsScheme({ "1": 10, x: 5, "-2": 3, "3": -1 })).toEqual({
      1: 10,
    });
  });
});

describe("pointsForResult", () => {
  it("scores by finishing position", () => {
    expect(pointsForResult(result("r1", 1), scheme)).toBe(25);
    expect(pointsForResult(result("r1", 10), scheme)).toBe(1);
    expect(pointsForResult(result("r1", 11), scheme)).toBe(0);
  });

  it("adds a fastest-lap bonus only to a finisher", () => {
    expect(
      pointsForResult(result("r1", 2, { fastestLap: true }), scheme, 1),
    ).toBe(19);
    expect(
      pointsForResult(
        result("r1", null, { status: ResultStatus.DNF, fastestLap: true }),
        scheme,
        1,
      ),
    ).toBe(0);
  });

  it("honours an explicit override, floored at zero", () => {
    expect(
      pointsForResult(result("r1", 20, { pointsOverride: 5 }), scheme),
    ).toBe(5);
    expect(
      pointsForResult(result("r1", 1, { pointsOverride: -3 }), scheme),
    ).toBe(0);
  });

  it("scores nothing for a disqualification", () => {
    expect(
      pointsForResult(result("r1", 1, { status: ResultStatus.DSQ }), scheme),
    ).toBe(0);
  });
});

describe("penaltyCountsAgainstPoints", () => {
  it("counts a penalty that still stands", () => {
    for (const status of [
      PenaltyStatus.ISSUED,
      PenaltyStatus.UNDER_APPEAL,
      PenaltyStatus.UPHELD,
      PenaltyStatus.REDUCED,
    ]) {
      expect(penaltyCountsAgainstPoints(status), status).toBe(true);
    }
  });

  it("stops counting one that was overturned", () => {
    expect(penaltyCountsAgainstPoints(PenaltyStatus.OVERTURNED)).toBe(false);
  });
});

describe("computeStandings — basics", () => {
  it("orders by points and counts wins and podiums", () => {
    const rows = run({
      entries: [
        entry("r1", "alice"),
        entry("r2", "bob"),
        entry("r3", "alice", { eventId: "e2" }),
        entry("r4", "bob", { eventId: "e2" }),
      ],
      results: [
        result("r1", 1),
        result("r2", 2),
        result("r3", 3),
        result("r4", 1),
      ],
    });
    expect(rows.map((r) => r.competitorKey)).toEqual(["bob", "alice"]);
    expect(rows[0].points).toBe(43);
    expect(rows[0].wins).toBe(1);
    expect(rows[1].podiums).toBe(2);
  });

  it("does not count a DNS as a start", () => {
    const rows = run({
      entries: [entry("r1", "alice")],
      results: [result("r1", null, { status: ResultStatus.DNS })],
    });
    expect(rows[0].starts).toBe(0);
  });

  it("ignores an entry with no result recorded", () => {
    expect(run({ entries: [entry("r1", "alice")] })).toEqual([]);
  });

  it("subtracts deductions from penalties that still stand", () => {
    const rows = run({
      entries: [entry("r1", "alice")],
      results: [result("r1", 1)],
      penalties: [
        {
          registrationId: "r1",
          status: PenaltyStatus.UPHELD,
          pointsDeducted: 10,
        },
      ],
    });
    expect(rows[0].grossPoints).toBe(25);
    expect(rows[0].pointsDeducted).toBe(10);
    expect(rows[0].points).toBe(15);
    expect(rows[0].penaltyCount).toBe(1);
  });

  it("restores points when a penalty is overturned", () => {
    const rows = run({
      entries: [entry("r1", "alice")],
      results: [result("r1", 1)],
      penalties: [
        {
          registrationId: "r1",
          status: PenaltyStatus.OVERTURNED,
          pointsDeducted: 10,
        },
      ],
    });
    expect(rows[0].points).toBe(25);
    // The penalty stays on the record even though it no longer costs points.
    expect(rows[0].penaltyCount).toBe(1);
  });

  it("never pushes a round negative", () => {
    const rows = run({
      entries: [entry("r1", "alice")],
      results: [result("r1", 10)],
      penalties: [
        {
          registrationId: "r1",
          status: PenaltyStatus.ISSUED,
          pointsDeducted: 50,
        },
      ],
    });
    expect(rows[0].points).toBe(0);
  });
});

describe("computeStandings — per-round weighting", () => {
  it("applies a double-points multiplier to the finale", () => {
    const rows = run({
      entries: [
        entry("r1", "alice"),
        entry("r2", "alice", { eventId: "finale", pointsMultiplier: 2 }),
      ],
      results: [result("r1", 1), result("r2", 1)],
    });
    expect(rows[0].points).toBe(75);
  });

  it("weights the round before the deduction is applied", () => {
    // A 10-point deduction on a double-points round costs 10, not 20.
    const rows = run({
      entries: [entry("r1", "alice", { pointsMultiplier: 2 })],
      results: [result("r1", 1)],
      penalties: [
        {
          registrationId: "r1",
          status: PenaltyStatus.ISSUED,
          pointsDeducted: 10,
        },
      ],
    });
    expect(rows[0].points).toBe(40);
  });
});

describe("computeStandings — classes", () => {
  const entries = [
    entry("r1", "alice", { seriesClassId: "gt3" }),
    entry("r2", "bob", { seriesClassId: "gt3" }),
    entry("r3", "carol", { seriesClassId: "gt4" }),
    entry("r4", "dave", { seriesClassId: null }),
  ];
  const results = [
    result("r1", 1),
    result("r2", 2),
    result("r3", 3),
    result("r4", 4),
  ];

  it("scores every entry together when no class is requested", () => {
    const rows = run({ entries, results });
    expect(rows).toHaveLength(4);
  });

  it("narrows to one class, scoring positions as recorded", () => {
    const rows = run({ entries, results, seriesClassId: "gt3" });
    expect(rows.map((r) => r.competitorKey)).toEqual(["alice", "bob"]);
  });

  it("supports a class of one, as a small grass-roots class often is", () => {
    const rows = run({ entries, results, seriesClassId: "gt4" });
    expect(rows).toHaveLength(1);
    expect(rows[0].competitorKey).toBe("carol");
  });

  it("can select the unclassified entries explicitly", () => {
    const rows = run({ entries, results, seriesClassId: null });
    expect(rows.map((r) => r.competitorKey)).toEqual(["dave"]);
  });

  it("handles many classes with free-form ids", () => {
    // A grass-roots region runs dozens of classes with local names, so nothing
    // here may assume a small fixed set.
    const many = Array.from({ length: 30 }, (_, i) =>
      entry(`r${i}`, `driver${i}`, { seriesClassId: `class-${i}` }),
    );
    const manyResults = many.map((e) => result(e.registrationId, 1));
    for (const e of many) {
      const rows = run({
        entries: many,
        results: manyResults,
        seriesClassId: e.seriesClassId,
      });
      expect(rows).toHaveLength(1);
    }
  });
});

describe("computeStandings — drivers' and teams' tables", () => {
  const entries = [
    entry("r1", "t_apex", {
      teamId: "t_apex",
      competitorLabel: "Apex Racing",
      driverIds: ["d_ann", "d_ben"],
    }),
    entry("r2", "t_apex", {
      eventId: "e2",
      teamId: "t_apex",
      competitorLabel: "Apex Racing",
      driverIds: ["d_ann", "d_cara"],
    }),
    entry("r3", "d_solo", { driverIds: ["d_solo"], competitorLabel: "Solo" }),
  ];
  const results = [result("r1", 1), result("r2", 2), result("r3", 3)];

  it("gives every declared driver the entry's points", () => {
    const rows = run({ entries, results, basis: "driver" });
    const byKey = Object.fromEntries(rows.map((r) => [r.competitorKey, r]));
    // Ann drove both rounds; Ben and Cara one each.
    expect(byKey.d_ann.points).toBe(43);
    expect(byKey.d_ben.points).toBe(25);
    expect(byKey.d_cara.points).toBe(18);
    expect(byKey.d_solo.points).toBe(15);
  });

  it("sums a team's rounds once regardless of crew size", () => {
    const rows = run({ entries, results, basis: "team" });
    expect(rows).toHaveLength(1);
    expect(rows[0].competitorKey).toBe("t_apex");
    expect(rows[0].points).toBe(43);
  });

  it("leaves individual entrants out of the teams' table", () => {
    const rows = run({ entries, results, basis: "team" });
    expect(rows.map((r) => r.competitorKey)).not.toContain("d_solo");
  });

  it("relabels driver keys from the supplied labels", () => {
    const rows = run({
      entries,
      results,
      basis: "driver",
      labels: { d_ann: "Ann Fisher" },
    });
    expect(rows.find((r) => r.competitorKey === "d_ann")?.competitorLabel).toBe(
      "Ann Fisher",
    );
  });
});

describe("computeStandings — dropped scores", () => {
  const season = ["e1", "e2", "e3", "e4"].map((eventId, i) =>
    entry(`r${i}`, "alice", { eventId }),
  );

  it("counts only the best N rounds", () => {
    const rows = run({
      entries: season,
      // 25, 18, 15 and 1 point.
      results: [
        result("r0", 1),
        result("r1", 2),
        result("r2", 3),
        result("r3", 10),
      ],
      config: { scheme, countBestRounds: 3 },
    });
    expect(rows[0].points).toBe(58);
    expect(rows[0].droppedRounds).toBe(1);
  });

  it("drops the worst round by net points, after deductions", () => {
    const rows = run({
      entries: season.slice(0, 2),
      results: [result("r0", 1), result("r1", 2)],
      // The win nets 5 after a deduction, so it becomes the round to drop.
      penalties: [
        {
          registrationId: "r0",
          status: PenaltyStatus.ISSUED,
          pointsDeducted: 20,
        },
      ],
      config: { scheme, countBestRounds: 1 },
    });
    expect(rows[0].points).toBe(18);
    expect(rows[0].droppedRounds).toBe(1);
  });

  it("still counts a dropped round as a start and a win", () => {
    const rows = run({
      entries: season.slice(0, 2),
      results: [result("r0", 1), result("r1", 1)],
      config: { scheme, countBestRounds: 1 },
    });
    expect(rows[0].points).toBe(25);
    // Dropping a score for points does not undo the race.
    expect(rows[0].starts).toBe(2);
    expect(rows[0].wins).toBe(2);
  });

  it("drops nothing when the season is shorter than the limit", () => {
    const rows = run({
      entries: season.slice(0, 2),
      results: [result("r0", 1), result("r1", 2)],
      config: { scheme, countBestRounds: 8 },
    });
    expect(rows[0].droppedRounds).toBe(0);
    expect(rows[0].points).toBe(43);
  });

  it("marks every round counted when no limit is set", () => {
    const rows = run({
      entries: season.slice(0, 2),
      results: [result("r0", 1), result("r1", 2)],
    });
    expect(rows[0].rounds.every((round) => round.counted)).toBe(true);
  });
});

describe("computeStandings — title eligibility", () => {
  it("marks a competitor short of the minimum starts ineligible", () => {
    const rows = run({
      entries: [entry("r1", "alice"), entry("r2", "bob")],
      results: [result("r1", 1), result("r2", 2)],
      config: { scheme, minStartsForTitle: 2 },
    });
    expect(rows.every((row) => !row.titleEligible)).toBe(true);
  });

  it("sorts ineligible competitors below eligible ones despite more points", () => {
    const rows = run({
      entries: [
        // Alice wins once; Bob finishes lower twice but meets the minimum.
        entry("r1", "alice"),
        entry("r2", "bob"),
        entry("r3", "bob", { eventId: "e2" }),
      ],
      results: [result("r1", 1), result("r2", 8), result("r3", 8)],
      config: { scheme, minStartsForTitle: 2 },
    });
    expect(rows[0].competitorKey).toBe("bob");
    expect(rows[0].titleEligible).toBe(true);
    expect(rows[1].competitorKey).toBe("alice");
    expect(rows[1].titleEligible).toBe(false);
    // Alice still has more points — she just cannot take the title.
    expect(rows[1].points).toBeGreaterThan(rows[0].points);
  });

  it("treats everyone as eligible when no minimum is set", () => {
    const rows = run({
      entries: [entry("r1", "alice")],
      results: [result("r1", 1)],
    });
    expect(rows[0].titleEligible).toBe(true);
  });
});

describe("computeStandings — tie-breaks", () => {
  it("breaks a points tie on wins", () => {
    const rows = run({
      entries: [
        entry("r1", "winner"),
        entry("r2", "steady"),
        entry("r3", "steady", { eventId: "e2" }),
      ],
      // 25 for the win; 15 + 10 for two lesser finishes.
      results: [result("r1", 1), result("r2", 3), result("r3", 5)],
    });
    expect(rows[0].competitorKey).toBe("winner");
  });

  it("falls back to the label for a total tie", () => {
    const rows = run({
      entries: [entry("r1", "zeta"), entry("r2", "alpha")],
      results: [result("r1", 5), result("r2", 5)],
    });
    expect(rows.map((r) => r.competitorKey)).toEqual(["alpha", "zeta"]);
  });
});
