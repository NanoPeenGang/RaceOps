import { TRPCError } from "@trpc/server";
import { ChannelKind, TeamRole } from "@prisma/client";
import type { ChatChannel, PrismaClient } from "@prisma/client";
import { canAccessChannel, isDepartmentMember } from "@/lib/channels";
import type { ScopeStanding } from "@/lib/channels";
import { TEAM_MANAGER_ROLES } from "@/lib/teams";
import { SERIES_ADMIN_ROLES } from "@/lib/permissions";
import { effectiveSeriesAccess } from "@/server/services/series-auth";

/**
 * Resolving who is in a department channel.
 *
 * `src/lib/channels.ts` holds the *rule* — pure, testable, shared with the
 * client. This holds the database work that answers the rule's question: what
 * does this person actually hold in this channel's scope?
 *
 * The two are separate on purpose. The rule is the thing worth testing
 * exhaustively and the thing the UI needs to render a room list without
 * asking the server about every channel in turn.
 */

/**
 * What somebody holds in a channel's scope.
 *
 * One round trip per scope kind. An event channel is the expensive case
 * because "engineers entered at this meeting" spans every entry in it, which
 * is exactly why it is worth having: nothing else on the platform can put the
 * paddock's engineers in one room.
 */
export async function standingInScope(
  db: PrismaClient,
  channel: Pick<
    ChatChannel,
    "teamId" | "eventId" | "seriesId" | "organizationId"
  >,
  userId: string,
): Promise<ScopeStanding> {
  if (channel.teamId) return teamStanding(db, channel.teamId, userId);
  if (channel.eventId) return eventStanding(db, channel.eventId, userId);
  if (channel.seriesId) return seriesStanding(db, channel.seriesId, userId);
  if (channel.organizationId) {
    return organizationStanding(db, channel.organizationId, userId);
  }
  return {};
}

async function teamStanding(
  db: PrismaClient,
  teamId: string,
  userId: string,
): Promise<ScopeStanding> {
  const membership = await db.teamMembership.findUnique({
    where: { teamId_userId: { teamId, userId } },
    select: { role: true, endDate: true },
  });
  // A departed member holds nothing. This is the whole reason membership is
  // derived rather than stored: the day someone leaves the team is the day
  // they leave every one of its channels, with nobody having to remember.
  if (!membership || membership.endDate !== null) return {};
  return {
    teamRole: membership.role,
    isScopeManager: TEAM_MANAGER_ROLES.includes(membership.role),
  };
}

async function seriesStanding(
  db: PrismaClient,
  seriesId: string,
  userId: string,
  eventId?: string,
): Promise<ScopeStanding> {
  const access = await effectiveSeriesAccess(db, seriesId, userId, eventId);
  const assignments = await db.staffAssignment.findMany({
    where: {
      userId,
      staffRole: { OR: [{ seriesId }, { organization: { series: { some: { id: seriesId } } } }] },
    },
    select: { staffRoleId: true },
  });

  return {
    seriesRole: access.seriesRole,
    staffRoleIds: assignments.map((assignment) => assignment.staffRoleId),
    isScopeManager: access.seriesRole
      ? SERIES_ADMIN_ROLES.roles.includes(access.seriesRole)
      : false,
  };
}

/**
 * Standing at an event: the series' staff, plus the team roles of anyone
 * entered in it.
 *
 * The second half is what makes a cross-paddock department channel possible.
 * A person can hold several — driving for one team and engineering for
 * another is ordinary in club racing — so the most senior role wins, since a
 * channel admitting engineers should admit somebody who is an engineer
 * somewhere in this paddock.
 */
async function eventStanding(
  db: PrismaClient,
  eventId: string,
  userId: string,
): Promise<ScopeStanding> {
  const event = await db.raceEvent.findUnique({
    where: { id: eventId },
    select: { seriesId: true },
  });
  if (!event) return {};

  const fromSeries = event.seriesId
    ? await seriesStanding(db, event.seriesId, userId, eventId)
    : {};

  const entries = await db.eventRegistration.findMany({
    where: {
      eventId,
      status: { in: ["PENDING", "CONFIRMED", "WAITLISTED"] },
      OR: [
        { submittedById: userId },
        { entrantUserId: userId },
        { team: { roster: { some: { userId, endDate: null } } } },
        { lineup: { some: { userId } } },
      ],
    },
    select: {
      teamId: true,
      team: {
        select: {
          roster: { where: { userId, endDate: null }, select: { role: true } },
        },
      },
    },
  });

  if (entries.length === 0) return fromSeries;

  const teamRoles = entries.flatMap((entry) =>
    entry.team ? entry.team.roster.map((member) => member.role) : [],
  );

  return {
    ...fromSeries,
    hasEntry: true,
    // A driver entered as an individual holds no team role but is still in the
    // paddock, so DRIVER is the honest floor rather than nothing at all.
    teamRole: mostSeniorTeamRole(teamRoles) ?? TeamRole.DRIVER,
  };
}

/**
 * Seniority order for picking one role out of several.
 *
 * Not the display order from `teams.ts`: this is about which role opens the
 * most doors, so leadership outranks the specialisms and MEMBER is last.
 */
const TEAM_ROLE_SENIORITY: readonly TeamRole[] = [
  TeamRole.OWNER,
  TeamRole.MANAGER,
  TeamRole.ENGINEER,
  TeamRole.CREW,
  TeamRole.DRIVER,
  TeamRole.MEMBER,
];

function mostSeniorTeamRole(roles: readonly TeamRole[]): TeamRole | null {
  for (const role of TEAM_ROLE_SENIORITY) {
    if (roles.includes(role)) return role;
  }
  return null;
}

async function organizationStanding(
  db: PrismaClient,
  organizationId: string,
  userId: string,
): Promise<ScopeStanding> {
  const membership = await db.organizationMembership.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
    select: { role: true },
  });
  const assignments = await db.staffAssignment.findMany({
    where: { userId, staffRole: { organizationId } },
    select: { staffRoleId: true },
  });
  if (!membership && assignments.length === 0) return {};

  return {
    orgRole: membership?.role ?? null,
    staffRoleIds: assignments.map((assignment) => assignment.staffRoleId),
    isScopeManager:
      membership?.role === "OWNER" || membership?.role === "ADMIN",
  };
}

export interface ChannelAccess {
  /** Can read and post. */
  allowed: boolean;
  /** Actually one of the department, rather than a manager looking in. */
  isMember: boolean;
  /** Can delete anyone's message and edit the channel. */
  canModerate: boolean;
}

export async function channelAccess(
  db: PrismaClient,
  channel: ChatChannel,
  userId: string,
): Promise<ChannelAccess> {
  const standing = await standingInScope(db, channel, userId);
  return accessFromStanding(channel, standing);
}

/**
 * The same decision, against a standing that has already been resolved.
 *
 * Split out because standing depends only on the *scope* and the person, and
 * every channel in one list shares a scope by construction. Listing a team's
 * channels through `channelAccess` therefore re-asked the database the same
 * question once per channel — resolve it once and this is pure.
 */
export function accessFromStanding(
  channel: Pick<
    ChatChannel,
    | "kind"
    | "teamRoles"
    | "seriesRoles"
    | "orgRoles"
    | "staffRoleId"
    | "includesEntrantTeams"
  >,
  standing: ScopeStanding,
): ChannelAccess {
  const audience = {
    kind: channel.kind,
    teamRoles: channel.teamRoles,
    seriesRoles: channel.seriesRoles,
    orgRoles: channel.orgRoles,
    staffRoleId: channel.staffRoleId,
    includesEntrantTeams: channel.includesEntrantTeams,
  };
  return {
    allowed: canAccessChannel(audience, standing),
    isMember: isDepartmentMember(audience, standing),
    canModerate: Boolean(standing.isScopeManager),
  };
}

/** Throws unless the caller may read and post in the channel. */
export async function assertChannelAccess(
  db: PrismaClient,
  channelId: string,
  userId: string,
): Promise<{ channel: ChatChannel; access: ChannelAccess }> {
  const channel = await db.chatChannel.findUnique({ where: { id: channelId } });
  if (!channel) throw new TRPCError({ code: "NOT_FOUND" });

  const access = await channelAccess(db, channel, userId);
  if (!access.allowed) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        channel.kind === ChannelKind.DEPARTMENT
          ? "That channel is for a different department."
          : "That channel is for members of its team or event.",
    });
  }
  return { channel, access };
}

/** Throws unless the caller may create or edit channels in this scope. */
export async function assertCanManageChannels(
  db: PrismaClient,
  scope: {
    teamId?: string | null;
    eventId?: string | null;
    seriesId?: string | null;
    organizationId?: string | null;
  },
  userId: string,
): Promise<void> {
  const standing = await standingInScope(
    db,
    {
      teamId: scope.teamId ?? null,
      eventId: scope.eventId ?? null,
      seriesId: scope.seriesId ?? null,
      organizationId: scope.organizationId ?? null,
    },
    userId,
  );
  if (!standing.isScopeManager) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only whoever runs this team, series or organization can set up channels.",
    });
  }
}
