import { describe, expect, it } from "vitest";
import { PenaltyStatus } from "@prisma/client";
import type { StandingsRow } from "@/lib/standings";
import {
  countActivePenalties,
  splitSchedule,
  summarizeTeamSeries,
  teamStandingsPosition,
  totalsAcrossSeries,
} from "@/lib/team-season";

function standing(
  teamId: string | null,
  overrides: Partial<StandingsRow> = {},
): StandingsRow {
  return {
    competitorKey: teamId ?? "solo",
    competitorLabel: teamId ?? "Solo entrant",
    teamId,
    starts: 0,
    wins: 0,
    podiums: 0,
    bestFinish: null,
    grossPoints: 0,
    pointsDeducted: 0,
    points: 0,
    penaltyCount: 0,
    droppedRounds: 0,
    titleEligible: true,
    rounds: [],
    ...overrides,
  };
}

const series = { id: "s1", name: "Endurance Cup", slug: "endurance-cup" };

describe("teamStandingsPosition", () => {
  it("returns the team's row and its 1-based position", () => {
    const rows = [
      standing("leader", { points: 50 }),
      standing("ours", { points: 40 }),
      standing("third", { points: 30 }),
    ];
    const found = teamStandingsPosition(rows, "ours");
    expect(found?.position).toBe(2);
    expect(found?.row.points).toBe(40);
  });

  it("is null when the team is not in the table", () => {
    expect(teamStandingsPosition([standing("other")], "ours")).toBeNull();
  });

  it("does not match individual entrants with no team", () => {
    // A solo entry has teamId null; looking up a team must not collide with it.
    expect(teamStandingsPosition([standing(null)], "ours")).toBeNull();
  });
});

describe("summarizeTeamSeries", () => {
  it("carries the standings row through, position included", () => {
    const rows = [
      standing("leader", { points: 60 }),
      standing("ours", {
        points: 44,
        starts: 5,
        wins: 1,
        podiums: 3,
        bestFinish: 1,
        pointsDeducted: 6,
        penaltyCount: 2,
      }),
    ];
    const summary = summarizeTeamSeries(series, rows, "ours");
    expect(summary).toEqual({
      seriesId: "s1",
      seriesName: "Endurance Cup",
      seriesSlug: "endurance-cup",
      position: 2,
      fieldSize: 2,
      points: 44,
      starts: 5,
      wins: 1,
      podiums: 3,
      bestFinish: 1,
      pointsDeducted: 6,
      penaltyCount: 2,
    });
  });

  it("reports a zeroed, unclassified summary for a team with no results", () => {
    // Entered but nothing scored yet — the series still belongs on the page.
    const summary = summarizeTeamSeries(series, [standing("other")], "ours");
    expect(summary.position).toBeNull();
    expect(summary.points).toBe(0);
    expect(summary.starts).toBe(0);
    expect(summary.bestFinish).toBeNull();
    expect(summary.fieldSize).toBe(1);
  });
});

describe("totalsAcrossSeries", () => {
  it("adds up starts, wins and podiums and takes the overall best finish", () => {
    const totals = totalsAcrossSeries([
      summarizeTeamSeries(series, [standing("ours", {
        starts: 4,
        wins: 1,
        podiums: 2,
        bestFinish: 1,
        points: 40,
      })], "ours"),
      summarizeTeamSeries(
        { id: "s2", name: "Sprint Cup", slug: "sprint-cup" },
        [standing("ours", { starts: 3, wins: 0, podiums: 1, bestFinish: 3, points: 18 })],
        "ours",
      ),
    ]);
    expect(totals).toEqual({
      seriesCount: 2,
      starts: 7,
      wins: 1,
      podiums: 3,
      bestFinish: 1,
      totalPoints: 58,
    });
  });

  it("is null-safe for a best finish nobody has set", () => {
    const totals = totalsAcrossSeries([
      summarizeTeamSeries(series, [standing("ours", { starts: 2 })], "ours"),
    ]);
    expect(totals.bestFinish).toBeNull();
  });

  it("is zeroed with no series", () => {
    expect(totalsAcrossSeries([])).toEqual({
      seriesCount: 0,
      starts: 0,
      wins: 0,
      podiums: 0,
      bestFinish: null,
      totalPoints: 0,
    });
  });
});

describe("countActivePenalties", () => {
  it("counts penalties that still stand", () => {
    expect(
      countActivePenalties([
        { status: PenaltyStatus.ISSUED },
        { status: PenaltyStatus.UPHELD },
        { status: PenaltyStatus.UNDER_APPEAL },
        { status: PenaltyStatus.REDUCED },
      ]),
    ).toBe(4);
  });

  it("does not count an overturned penalty", () => {
    expect(
      countActivePenalties([
        { status: PenaltyStatus.OVERTURNED },
        { status: PenaltyStatus.ISSUED },
      ]),
    ).toBe(1);
  });

  it("is zero for no penalties", () => {
    expect(countActivePenalties([])).toBe(0);
  });
});

describe("splitSchedule", () => {
  const now = new Date("2026-06-15T12:00:00Z");

  it("splits into upcoming ascending and past descending", () => {
    const events = [
      { id: "far", date: new Date("2026-09-01T00:00:00Z") },
      { id: "old", date: new Date("2026-01-01T00:00:00Z") },
      { id: "soon", date: new Date("2026-06-20T00:00:00Z") },
      { id: "recent", date: new Date("2026-06-01T00:00:00Z") },
    ];
    const { upcoming, past } = splitSchedule(events, now);
    expect(upcoming.map((e) => e.id)).toEqual(["soon", "far"]);
    expect(past.map((e) => e.id)).toEqual(["recent", "old"]);
  });

  it("counts an event happening right now as upcoming", () => {
    // A race weekend in progress belongs on the "next up" list, not history.
    const { upcoming } = splitSchedule([{ id: "live", date: now }], now);
    expect(upcoming.map((e) => e.id)).toEqual(["live"]);
  });

  it("handles an empty calendar", () => {
    expect(splitSchedule([], now)).toEqual({ upcoming: [], past: [] });
  });
});
