import { describe, expect, it } from "vitest";
import {
  ChannelKind,
  OrgRole,
  SeriesRole,
  TeamRole,
} from "@prisma/client";
import {
  TEAM_CHANNEL_TEMPLATES,
  availableTemplates,
  canAccessChannel,
  describeAudience,
  describeAudienceProblem,
  isDepartmentMember,
} from "@/lib/channels";
import type { ChannelAudience } from "@/lib/channels";
import { TEAM_ROLE_LABELS } from "@/lib/teams";
import { SERIES_ROLE_LABELS } from "@/lib/permissions";

const ORG_ROLE_LABELS: Record<OrgRole, string> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  STAFF: "Staff",
};

const department = (over: Partial<ChannelAudience> = {}): ChannelAudience => ({
  kind: ChannelKind.DEPARTMENT,
  teamRoles: [],
  seriesRoles: [],
  orgRoles: [],
  staffRoleId: null,
  ...over,
});

describe("canAccessChannel: department rooms", () => {
  const engineers = department({ teamRoles: [TeamRole.ENGINEER] });

  it("lets in somebody holding the role", () => {
    expect(canAccessChannel(engineers, { teamRole: TeamRole.ENGINEER })).toBe(
      true,
    );
  });

  it("keeps out somebody who does not", () => {
    expect(canAccessChannel(engineers, { teamRole: TeamRole.DRIVER })).toBe(
      false,
    );
  });

  it("keeps out somebody with no standing at all", () => {
    // This is the departed-member case: `standingInScope` returns {} the day
    // a membership ends, and that has to close every door on its own.
    expect(canAccessChannel(engineers, {})).toBe(false);
  });

  it("lets the person running the scope in, to moderate", () => {
    expect(
      canAccessChannel(engineers, {
        teamRole: TeamRole.OWNER,
        isScopeManager: true,
      }),
    ).toBe(true);
  });

  it("does not count a manager as one of the department", () => {
    // A team manager reading the crew channel is not one of the crew, and a
    // member list that says otherwise is lying about who is in the room.
    const standing = { teamRole: TeamRole.OWNER, isScopeManager: true };
    expect(canAccessChannel(engineers, standing)).toBe(true);
    expect(isDepartmentMember(engineers, standing)).toBe(false);
  });

  it("accepts a match on any of the role lists", () => {
    const mixed = department({
      teamRoles: [TeamRole.ENGINEER],
      seriesRoles: [SeriesRole.RACE_CONTROL],
      orgRoles: [OrgRole.ADMIN],
    });
    expect(canAccessChannel(mixed, { seriesRole: SeriesRole.RACE_CONTROL })).toBe(
      true,
    );
    expect(canAccessChannel(mixed, { orgRole: OrgRole.ADMIN })).toBe(true);
    expect(canAccessChannel(mixed, { orgRole: OrgRole.STAFF })).toBe(false);
  });

  it("accepts a custom staff role", () => {
    const scrutineers = department({ staffRoleId: "role_1" });
    expect(canAccessChannel(scrutineers, { staffRoleIds: ["role_1"] })).toBe(
      true,
    );
    expect(canAccessChannel(scrutineers, { staffRoleIds: ["role_2"] })).toBe(
      false,
    );
  });
});

describe("canAccessChannel: entrant team roles on an event channel", () => {
  const engineers = department({
    teamRoles: [TeamRole.ENGINEER],
    includesEntrantTeams: true,
  });
  const seriesOnly = department({
    teamRoles: [TeamRole.ENGINEER],
    includesEntrantTeams: false,
  });

  it("admits an entrant's engineer when the channel says so", () => {
    // The cross-paddock room: every engineer at the meeting, from every team.
    expect(
      canAccessChannel(engineers, {
        teamRole: TeamRole.ENGINEER,
        hasEntry: true,
      }),
    ).toBe(true);
  });

  it("keeps an entrant's engineer out when it does not", () => {
    expect(
      canAccessChannel(seriesOnly, {
        teamRole: TeamRole.ENGINEER,
        hasEntry: true,
      }),
    ).toBe(false);
  });

  it("still admits somebody whose role is not from an entry", () => {
    // Somebody with the role and no entry is series staff, and the entrant
    // switch is not about them.
    expect(
      canAccessChannel(seriesOnly, { teamRole: TeamRole.ENGINEER }),
    ).toBe(true);
  });
});

describe("canAccessChannel: open rooms", () => {
  const open = department({ kind: ChannelKind.OPEN });

  it("admits anyone with any standing in the scope", () => {
    expect(canAccessChannel(open, { teamRole: TeamRole.MEMBER })).toBe(true);
    expect(canAccessChannel(open, { seriesRole: SeriesRole.STEWARD })).toBe(true);
    expect(canAccessChannel(open, { hasEntry: true })).toBe(true);
    expect(canAccessChannel(open, { staffRoleIds: ["r"] })).toBe(true);
  });

  it("admits nobody with no standing", () => {
    expect(canAccessChannel(open, {})).toBe(false);
    expect(canAccessChannel(open, { staffRoleIds: [] })).toBe(false);
  });
});

describe("describeAudienceProblem", () => {
  it("refuses a department nobody can enter", () => {
    expect(describeAudienceProblem(department())).toContain("at least one role");
  });

  it("refuses an open channel carrying a role filter", () => {
    // A contradiction that reads like a permission — which is worse than an
    // error, because it looks enforced.
    const problem = describeAudienceProblem(
      department({ kind: ChannelKind.OPEN, teamRoles: [TeamRole.CREW] }),
    );
    expect(problem).toContain("open to the whole scope");
  });

  it("is happy with a department that names a role", () => {
    expect(
      describeAudienceProblem(department({ teamRoles: [TeamRole.CREW] })),
    ).toBeNull();
  });

  it("is happy with an open channel that names nothing", () => {
    expect(
      describeAudienceProblem(department({ kind: ChannelKind.OPEN })),
    ).toBeNull();
  });

  it("counts a staff role as an audience", () => {
    expect(
      describeAudienceProblem(department({ staffRoleId: "role_1" })),
    ).toBeNull();
  });
});

describe("describeAudience", () => {
  const labels = {
    team: TEAM_ROLE_LABELS,
    series: SERIES_ROLE_LABELS,
    org: ORG_ROLE_LABELS,
  };

  it("names one role plainly", () => {
    expect(
      describeAudience(department({ teamRoles: [TeamRole.ENGINEER] }), labels),
    ).toBe("Engineer");
  });

  it("joins several the way a person would say them", () => {
    expect(
      describeAudience(
        department({ teamRoles: [TeamRole.ENGINEER, TeamRole.CREW] }),
        labels,
      ),
    ).toBe("Engineer and Crew");
  });

  it("says so for an open channel", () => {
    expect(
      describeAudience(department({ kind: ChannelKind.OPEN }), labels),
    ).toBe("Everyone in this scope");
  });

  it("includes a custom staff role by name", () => {
    expect(
      describeAudience(department({ staffRoleId: "r" }), labels, "Chief Scrutineer"),
    ).toBe("Chief Scrutineer");
  });
});

describe("channel templates", () => {
  it("gives every suggestion a role list, so none is dead on arrival", () => {
    for (const template of TEAM_CHANNEL_TEMPLATES) {
      expect(template.teamRoles.length, template.name).toBeGreaterThan(0);
      expect(template.slug).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it("has no two templates sharing a slug", () => {
    const slugs = TEAM_CHANNEL_TEMPLATES.map((template) => template.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("stops offering one that has already been made", () => {
    const remaining = availableTemplates(["engineering"]);
    expect(remaining.map((template) => template.slug)).not.toContain(
      "engineering",
    );
    expect(remaining.length).toBe(TEAM_CHANNEL_TEMPLATES.length - 1);
  });

  it("keeps management narrow", () => {
    // The whole point of the management room is that it is not the roster.
    const management = TEAM_CHANNEL_TEMPLATES.find(
      (template) => template.slug === "management",
    );
    expect(management?.teamRoles).toEqual([TeamRole.OWNER, TeamRole.MANAGER]);
  });
});
