import { TeamRole } from "@prisma/client";

/**
 * Team roster helpers. A race team is read as two groups — who drives and who
 * runs the car — so the roster is split that way rather than listed flat.
 */

export const TEAM_ROLE_LABELS: Record<TeamRole, string> = {
  OWNER: "Owner",
  MANAGER: "Manager",
  DRIVER: "Driver",
  CREW: "Crew",
  ENGINEER: "Engineer",
  MEMBER: "Member",
};

/** Roles allowed to manage the team: roster, sponsors, entries, settings. */
export const TEAM_MANAGER_ROLES: TeamRole[] = [
  TeamRole.OWNER,
  TeamRole.MANAGER,
];

export function isTeamManager(role: TeamRole | null | undefined): boolean {
  return role !== null && role !== undefined && TEAM_MANAGER_ROLES.includes(role);
}

/** Display order: leadership, then drivers, then the people running the car. */
const ROLE_ORDER: TeamRole[] = [
  TeamRole.OWNER,
  TeamRole.MANAGER,
  TeamRole.DRIVER,
  TeamRole.ENGINEER,
  TeamRole.CREW,
  TeamRole.MEMBER,
];

export interface RosterMember {
  id: string;
  role: TeamRole;
  startDate: Date;
  endDate: Date | null;
}

export interface RosterSplit<T extends RosterMember> {
  drivers: T[];
  staff: T[];
  /** Everyone still on the team, in display order. */
  active: T[];
  /** Past members, most recently departed first. */
  alumni: T[];
}

/**
 * Splits a roster into drivers, staff and alumni.
 *
 * An owner or manager who is also on the driving strength is a common case in
 * club racing, but a membership only carries one role — so leadership counts as
 * staff here, and a driving owner is expected to be recorded as DRIVER with
 * ownership implied by the OWNER row.
 */
export function splitRoster<T extends RosterMember>(
  roster: T[],
): RosterSplit<T> {
  const active = roster
    .filter((member) => member.endDate === null)
    .sort(byRoleThenTenure);
  const alumni = roster
    .filter((member) => member.endDate !== null)
    .sort((a, b) => (b.endDate!.getTime() ?? 0) - (a.endDate!.getTime() ?? 0));

  return {
    drivers: active.filter((member) => member.role === TeamRole.DRIVER),
    staff: active.filter((member) => member.role !== TeamRole.DRIVER),
    active,
    alumni,
  };
}

function byRoleThenTenure(a: RosterMember, b: RosterMember): number {
  const rank = ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role);
  if (rank !== 0) return rank;
  // Longest-serving first within a role.
  return a.startDate.getTime() - b.startDate.getTime();
}

/**
 * Whether removing this member would leave the team with no owner. Teams must
 * always have at least one, or nobody can administer them again.
 */
export function wouldOrphanTeam<T extends RosterMember>(
  roster: T[],
  memberId: string,
): boolean {
  const target = roster.find((member) => member.id === memberId);
  if (!target || target.role !== TeamRole.OWNER || target.endDate !== null) {
    return false;
  }
  const otherOwners = roster.filter(
    (member) =>
      member.id !== memberId &&
      member.role === TeamRole.OWNER &&
      member.endDate === null,
  );
  return otherOwners.length === 0;
}
