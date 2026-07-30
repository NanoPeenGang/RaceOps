import { describe, expect, it } from "vitest";
import { TeamRole } from "@prisma/client";
import {
  TEAM_ROLE_LABELS,
  isTeamManager,
  splitRoster,
  wouldOrphanTeam,
} from "@/lib/teams";

function member(
  id: string,
  role: TeamRole,
  opts: { start?: string; end?: string | null } = {},
) {
  return {
    id,
    role,
    startDate: new Date(opts.start ?? "2026-01-01"),
    endDate: opts.end ? new Date(opts.end) : null,
  };
}

describe("TEAM_ROLE_LABELS", () => {
  it("labels every team role", () => {
    for (const role of Object.values(TeamRole)) {
      expect(TEAM_ROLE_LABELS[role], role).toBeTruthy();
    }
  });
});

describe("isTeamManager", () => {
  it("accepts owners and managers only", () => {
    expect(isTeamManager(TeamRole.OWNER)).toBe(true);
    expect(isTeamManager(TeamRole.MANAGER)).toBe(true);
    expect(isTeamManager(TeamRole.ENGINEER)).toBe(false);
    expect(isTeamManager(TeamRole.DRIVER)).toBe(false);
  });

  it("treats a missing role as not a manager", () => {
    expect(isTeamManager(null)).toBe(false);
    expect(isTeamManager(undefined)).toBe(false);
  });
});

describe("splitRoster", () => {
  it("separates drivers from staff", () => {
    const split = splitRoster([
      member("d1", TeamRole.DRIVER),
      member("e1", TeamRole.ENGINEER),
      member("o1", TeamRole.OWNER),
    ]);
    expect(split.drivers.map((m) => m.id)).toEqual(["d1"]);
    expect(split.staff.map((m) => m.id)).toEqual(["o1", "e1"]);
  });

  it("orders active members by role then tenure", () => {
    const split = splitRoster([
      member("crew", TeamRole.CREW),
      member("newer-driver", TeamRole.DRIVER, { start: "2026-06-01" }),
      member("manager", TeamRole.MANAGER),
      member("older-driver", TeamRole.DRIVER, { start: "2024-01-01" }),
      member("owner", TeamRole.OWNER),
    ]);
    expect(split.active.map((m) => m.id)).toEqual([
      "owner",
      "manager",
      "older-driver",
      "newer-driver",
      "crew",
    ]);
  });

  it("moves departed members to alumni, most recent first", () => {
    const split = splitRoster([
      member("current", TeamRole.DRIVER),
      member("left-early", TeamRole.DRIVER, { end: "2025-03-01" }),
      member("left-late", TeamRole.CREW, { end: "2026-02-01" }),
    ]);
    expect(split.active.map((m) => m.id)).toEqual(["current"]);
    expect(split.alumni.map((m) => m.id)).toEqual(["left-late", "left-early"]);
    // A departed driver is not on the current driving strength.
    expect(split.drivers.map((m) => m.id)).toEqual(["current"]);
  });

  it("handles an empty roster", () => {
    const split = splitRoster([]);
    expect(split).toEqual({
      drivers: [],
      staff: [],
      active: [],
      alumni: [],
    });
  });
});

describe("wouldOrphanTeam", () => {
  it("blocks removing the last owner", () => {
    const roster = [member("o1", TeamRole.OWNER), member("d1", TeamRole.DRIVER)];
    expect(wouldOrphanTeam(roster, "o1")).toBe(true);
  });

  it("allows removing an owner when another remains", () => {
    const roster = [member("o1", TeamRole.OWNER), member("o2", TeamRole.OWNER)];
    expect(wouldOrphanTeam(roster, "o1")).toBe(false);
  });

  it("does not count a departed owner as cover", () => {
    const roster = [
      member("o1", TeamRole.OWNER),
      member("o2", TeamRole.OWNER, { end: "2025-01-01" }),
    ];
    expect(wouldOrphanTeam(roster, "o1")).toBe(true);
  });

  it("is false for non-owners and unknown members", () => {
    const roster = [member("o1", TeamRole.OWNER), member("d1", TeamRole.DRIVER)];
    expect(wouldOrphanTeam(roster, "d1")).toBe(false);
    expect(wouldOrphanTeam(roster, "nobody")).toBe(false);
  });
});
