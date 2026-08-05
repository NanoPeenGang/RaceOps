import {
  ChannelKind,
  OrgRole,
  SeriesRole,
  TeamRole,
} from "@prisma/client";

/**
 * Department channels: a room narrower than the scope it lives in.
 *
 * The rule that makes this worth having is that membership is **derived, never
 * stored**. You are in the engineers' channel while you are an engineer on
 * that team, and you are out of it the moment you are not. A stored member
 * list would leave a departed engineer reading the engineers' channel until
 * somebody remembered to prune it — which is precisely the failure a private
 * channel exists to prevent.
 *
 * Everything here is pure. The router calls it to decide access, the console
 * calls it to decide what to render, and the two cannot drift.
 */

export interface ChannelAudience {
  kind: ChannelKind;
  teamRoles: readonly TeamRole[];
  seriesRoles: readonly SeriesRole[];
  orgRoles: readonly OrgRole[];
  staffRoleId: string | null;
  /**
   * On an event channel, whether entrants' *team* roles count.
   *
   * This is the cross-paddock department room: every engineer entered in the
   * meeting, from every team. Off, `teamRoles` is ignored on an event channel
   * and only the series' own staff are considered.
   */
  includesEntrantTeams?: boolean;
}

/**
 * What a person holds in the channel's scope.
 *
 * All optional because a scope only has some of them: a team channel is
 * decided by `teamRole` alone, an organization channel by `orgRole` and
 * `staffRoleIds`. Absent means "does not hold one", never "unknown" — the
 * caller resolves that before asking.
 */
export interface ScopeStanding {
  teamRole?: TeamRole | null;
  seriesRole?: SeriesRole | null;
  orgRole?: OrgRole | null;
  staffRoleIds?: readonly string[];
  /**
   * Whether this person runs the scope: a team owner or manager, a series
   * admin, an organization owner. Managers can always see and moderate the
   * channels in their own scope — somebody has to be able to clean up a room
   * they are not a member of, and there is no other candidate.
   */
  isScopeManager?: boolean;
  /** Whether this person has an entry in the event, for event channels. */
  hasEntry?: boolean;
}

/**
 * Whether somebody can read and post in a channel.
 *
 * An `OPEN` channel admits anyone with any standing at all in the scope. A
 * `DEPARTMENT` channel admits only the roles it names — plus scope managers,
 * who are how a room gets moderated.
 */
export function canAccessChannel(
  channel: ChannelAudience,
  standing: ScopeStanding,
): boolean {
  if (channel.kind === ChannelKind.OPEN) {
    return hasAnyStanding(standing);
  }
  if (standing.isScopeManager) return true;
  return matchesAudience(channel, standing);
}

/**
 * Whether somebody is a *member* of the department, as opposed to being able
 * to see it.
 *
 * Separate from `canAccessChannel` because a team manager reading the crew
 * channel is not one of the crew, and a channel that lists its members should
 * say so honestly rather than counting everyone who can open it.
 */
export function isDepartmentMember(
  channel: ChannelAudience,
  standing: ScopeStanding,
): boolean {
  if (channel.kind === ChannelKind.OPEN) return hasAnyStanding(standing);
  return matchesAudience(channel, standing);
}

function matchesAudience(
  channel: ChannelAudience,
  standing: ScopeStanding,
): boolean {
  if (
    channel.staffRoleId &&
    standing.staffRoleIds?.includes(channel.staffRoleId)
  ) {
    return true;
  }
  if (
    standing.teamRole &&
    channel.teamRoles.includes(standing.teamRole) &&
    // On an event channel, entrants' team roles only count when the channel
    // says they do. Otherwise "engineers" would mean the series' engineers.
    (channel.includesEntrantTeams !== false || !standing.hasEntry)
  ) {
    return true;
  }
  if (standing.seriesRole && channel.seriesRoles.includes(standing.seriesRole)) {
    return true;
  }
  if (standing.orgRole && channel.orgRoles.includes(standing.orgRole)) {
    return true;
  }
  return false;
}

function hasAnyStanding(standing: ScopeStanding): boolean {
  return Boolean(
    standing.teamRole ??
      standing.seriesRole ??
      standing.orgRole ??
      standing.isScopeManager ??
      standing.hasEntry ??
      (standing.staffRoleIds?.length ? true : null),
  );
}

/**
 * Whether a channel definition is coherent.
 *
 * A department with no audience is a room nobody can enter; an open channel
 * carrying a role filter is a contradiction that reads like a permission. The
 * database enforces both with a CHECK — this is the same rule stated where a
 * form can show it before the save fails.
 */
export function describeAudienceProblem(
  channel: Pick<
    ChannelAudience,
    "kind" | "teamRoles" | "seriesRoles" | "orgRoles" | "staffRoleId"
  >,
): string | null {
  const named =
    channel.teamRoles.length +
    channel.seriesRoles.length +
    channel.orgRoles.length +
    (channel.staffRoleId ? 1 : 0);

  if (channel.kind === ChannelKind.OPEN && named > 0) {
    return "An open channel is open to the whole scope — clear the role filter, or make it a department.";
  }
  if (channel.kind === ChannelKind.DEPARTMENT && named === 0) {
    return "Pick at least one role, or nobody can get in.";
  }
  return null;
}

/** "Engineers and crew" — who is in the room, for the channel header. */
export function describeAudience(
  channel: ChannelAudience,
  labels: {
    team: Record<TeamRole, string>;
    series: Record<SeriesRole, string>;
    org: Record<OrgRole, string>;
  },
  staffRoleName?: string | null,
): string {
  if (channel.kind === ChannelKind.OPEN) return "Everyone in this scope";

  const names = [
    ...channel.teamRoles.map((role) => labels.team[role]),
    ...channel.seriesRoles.map((role) => labels.series[role]),
    ...channel.orgRoles.map((role) => labels.org[role]),
    ...(staffRoleName ? [staffRoleName] : []),
  ];
  if (names.length === 0) return "Nobody — this channel has no audience";
  if (names.length === 1) return names[0]!;
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

export interface ChannelTemplate {
  name: string;
  slug: string;
  description: string;
  teamRoles: TeamRole[];
}

/**
 * The department channels a team almost certainly wants.
 *
 * Offered as one-click suggestions rather than created automatically. A team
 * of three does not want four channels, and a platform that creates rooms
 * nobody asked for teaches people to ignore the room list.
 */
export const TEAM_CHANNEL_TEMPLATES: readonly ChannelTemplate[] = [
  {
    name: "Engineering",
    slug: "engineering",
    description: "Data, setup direction and what the car is actually doing.",
    teamRoles: [TeamRole.ENGINEER, TeamRole.OWNER, TeamRole.MANAGER],
  },
  {
    name: "Crew",
    slug: "crew",
    description: "Pit stops, the garage, and what needs doing before the next session.",
    teamRoles: [TeamRole.CREW, TeamRole.ENGINEER, TeamRole.MANAGER],
  },
  {
    name: "Drivers",
    slug: "drivers",
    description: "Rotation, seat time and how the car feels.",
    teamRoles: [TeamRole.DRIVER, TeamRole.OWNER, TeamRole.MANAGER],
  },
  {
    name: "Management",
    slug: "management",
    description: "Entries, budget and sponsors. Not for the whole roster.",
    teamRoles: [TeamRole.OWNER, TeamRole.MANAGER],
  },
];

/** Suggestions minus the ones already made. Matched on slug. */
export function availableTemplates(
  existingSlugs: readonly string[],
): ChannelTemplate[] {
  const taken = new Set(existingSlugs);
  return TEAM_CHANNEL_TEMPLATES.filter(
    (template) => !taken.has(template.slug),
  );
}
