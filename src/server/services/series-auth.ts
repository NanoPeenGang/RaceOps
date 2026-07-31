import { TRPCError } from "@trpc/server";
import { Permission, SeriesRole } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import {
  ORG_ROLE_PERMISSIONS,
  satisfies,
  SERIES_ADMIN_ROLES,
  SERIES_APPEAL_ROLES,
  SERIES_AUDIT_ROLES,
  SERIES_EVENT_ROLES,
  SERIES_PENALTY_ROLES,
  SERIES_ROLE_PERMISSIONS,
  SERIES_VOLUNTEER_ROLES,
  type Capability,
} from "@/lib/permissions";

/**
 * Row-level authorization for series-scoped actions.
 *
 * Two systems grant access and either is enough. The built-in `SeriesRole` on
 * a membership covers the common case; custom staff roles cover clubs whose
 * jobs do not map onto five fixed names. Both resolve here so a call site only
 * ever names the capability it needs.
 *
 * Capabilities are re-exported so every existing call site keeps reading the
 * same way — `assertSeriesRole(db, id, userId, SERIES_EVENT_ROLES)` — while
 * now also honouring a custom role that carries the matching permission.
 */

export {
  SERIES_ADMIN_ROLES,
  SERIES_APPEAL_ROLES,
  SERIES_AUDIT_ROLES,
  SERIES_EVENT_ROLES,
  SERIES_PENALTY_ROLES,
  SERIES_VOLUNTEER_ROLES,
};
export type { Capability };

export async function getSeriesRole(
  db: PrismaClient,
  seriesId: string,
  userId: string,
): Promise<SeriesRole | null> {
  const membership = await db.seriesMembership.findUnique({
    where: { seriesId_userId: { seriesId, userId } },
    select: { role: true },
  });
  return membership?.role ?? null;
}

/** Everything someone holds in one series, from every source. */
export interface EffectiveAccess {
  /// Null when they hold no membership but do hold a custom role.
  seriesRole: SeriesRole | null;
  permissions: Permission[];
  /// Named roles, for showing "why" on a staff list.
  roleNames: string[];
}

/**
 * Resolves what one person may do in one series.
 *
 * Sources, all unioned:
 *   - their `SeriesMembership` role, if any;
 *   - custom staff roles granted for this series;
 *   - custom staff roles granted at the owning organization, which reach every
 *     series it owns unless the assignment narrows them;
 *   - their organization membership role.
 *
 * `eventId` narrows nothing — it *widens*: an assignment pinned to one event
 * grants its permissions for that event only, which is how a hired-in official
 * for a single round works.
 */
export async function effectiveSeriesAccess(
  db: PrismaClient,
  seriesId: string,
  userId: string,
  eventId?: string | null,
): Promise<EffectiveAccess> {
  const series = await db.series.findUnique({
    where: { id: seriesId },
    select: { organizationId: true },
  });

  const [membership, orgMembership, assignments] = await Promise.all([
    db.seriesMembership.findUnique({
      where: { seriesId_userId: { seriesId, userId } },
      select: { role: true },
    }),
    series?.organizationId
      ? db.organizationMembership.findUnique({
          where: {
            organizationId_userId: {
              organizationId: series.organizationId,
              userId,
            },
          },
          select: { role: true },
        })
      : null,
    db.staffAssignment.findMany({
      where: {
        userId,
        OR: [
          // Granted for this series specifically.
          { seriesId },
          // Granted for one event of it.
          ...(eventId ? [{ eventId }] : []),
          // Granted organization-wide and not narrowed to somewhere else.
          ...(series?.organizationId
            ? [
                {
                  seriesId: null,
                  eventId: null,
                  staffRole: { organizationId: series.organizationId },
                },
              ]
            : []),
          // A role defined on this series, granted without further narrowing.
          { seriesId: null, eventId: null, staffRole: { seriesId } },
        ],
      },
      select: {
        staffRole: { select: { name: true, permissions: true } },
      },
    }),
  ]);

  const permissions = new Set<Permission>();
  const roleNames: string[] = [];

  if (membership) {
    for (const permission of SERIES_ROLE_PERMISSIONS[membership.role]) {
      permissions.add(permission);
    }
  }
  if (orgMembership) {
    for (const permission of ORG_ROLE_PERMISSIONS[orgMembership.role]) {
      permissions.add(permission);
    }
  }
  for (const assignment of assignments) {
    roleNames.push(assignment.staffRole.name);
    for (const permission of assignment.staffRole.permissions) {
      permissions.add(permission);
    }
  }

  return {
    seriesRole: membership?.role ?? null,
    permissions: [...permissions],
    roleNames,
  };
}

/**
 * Row-level authorization for series-scoped actions. Throws rather than
 * returning a boolean so call sites cannot forget to check the result.
 */
export async function assertSeriesRole(
  db: PrismaClient,
  seriesId: string,
  userId: string,
  capability: Capability,
): Promise<SeriesRole | null> {
  const access = await effectiveSeriesAccess(db, seriesId, userId);
  if (!satisfies(capability, access)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You do not have permission to manage this series.",
    });
  }
  return access.seriesRole;
}

/**
 * Same check, resolved from an event id. Events that do not belong to a
 * managed series have no organizer chain and are rejected.
 */
export async function assertEventOrganizer(
  db: PrismaClient,
  eventId: string,
  userId: string,
  capability: Capability,
): Promise<{ seriesId: string; role: SeriesRole | null }> {
  const event = await db.raceEvent.findUnique({
    where: { id: eventId },
    select: { seriesId: true },
  });
  if (!event) throw new TRPCError({ code: "NOT_FOUND" });
  if (!event.seriesId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "This event is not managed by a series.",
    });
  }
  // Event-scoped assignments count here and nowhere else: an official hired
  // for one round should reach that round and not the championship.
  const access = await effectiveSeriesAccess(
    db,
    event.seriesId,
    userId,
    eventId,
  );
  if (!satisfies(capability, access)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You do not have permission to manage this series.",
    });
  }
  return { seriesId: event.seriesId, role: access.seriesRole };
}

/**
 * Ownership acts: deleting a series, and minting another owner.
 *
 * Deliberately checks the built-in `OWNER` membership and nothing else — no
 * custom role, no organization role, no permission. These are not capabilities
 * that can be delegated: if they were, an organization administrator could
 * grant themselves a role that deletes a championship they do not own, and the
 * permission system would have quietly become a way around ownership.
 */
export async function assertSeriesOwner(
  db: PrismaClient,
  seriesId: string,
  userId: string,
): Promise<void> {
  const role = await getSeriesRole(db, seriesId, userId);
  if (role !== SeriesRole.OWNER) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "Only an owner of this series can do that. Ownership cannot be delegated to a staff role.",
    });
  }
}

/**
 * Whether someone holds a capability, without throwing.
 * For read paths that show more to officials rather than refusing everyone.
 */
export async function hasSeriesCapability(
  db: PrismaClient,
  seriesId: string,
  userId: string,
  capability: Capability,
  eventId?: string | null,
): Promise<boolean> {
  const access = await effectiveSeriesAccess(db, seriesId, userId, eventId);
  return satisfies(capability, access);
}

/**
 * Organizer user ids for an event, for notification fan-out.
 *
 * Built-in memberships and custom staff roles carrying the permission, so a
 * club that replaced race control with its own role still gets told when
 * something lands in the queue.
 */
export async function eventOrganizerIds(
  db: PrismaClient,
  seriesId: string,
  capability: Capability = SERIES_EVENT_ROLES,
): Promise<string[]> {
  const [memberships, assignments] = await Promise.all([
    db.seriesMembership.findMany({
      where: { seriesId, role: { in: [...capability.roles] } },
      select: { userId: true },
    }),
    db.staffAssignment.findMany({
      where: {
        staffRole: { permissions: { has: capability.permission } },
        OR: [
          { seriesId },
          { series: { id: seriesId } },
          { staffRole: { seriesId } },
          {
            seriesId: null,
            eventId: null,
            staffRole: { organization: { series: { some: { id: seriesId } } } },
          },
        ],
      },
      select: { userId: true },
    }),
  ]);
  return [
    ...new Set([
      ...memberships.map((m) => m.userId),
      ...assignments.map((a) => a.userId),
    ]),
  ];
}
