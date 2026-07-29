import { TRPCError } from "@trpc/server";
import { SeriesRole } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";

/** Roles allowed to change series settings and manage the organizer roster. */
export const SERIES_ADMIN_ROLES: SeriesRole[] = [
  SeriesRole.OWNER,
  SeriesRole.ADMIN,
];

/** Roles allowed to run events: create/publish, and decide entries. */
export const SERIES_EVENT_ROLES: SeriesRole[] = [
  SeriesRole.OWNER,
  SeriesRole.ADMIN,
  SeriesRole.RACE_CONTROL,
];

/** Roles allowed to manage volunteer shifts and signups. */
export const SERIES_VOLUNTEER_ROLES: SeriesRole[] = [
  SeriesRole.OWNER,
  SeriesRole.ADMIN,
  SeriesRole.VOLUNTEER_COORDINATOR,
];

/** Roles allowed to issue penalties — race control and stewards. */
export const SERIES_PENALTY_ROLES: SeriesRole[] = [
  SeriesRole.OWNER,
  SeriesRole.ADMIN,
  SeriesRole.RACE_CONTROL,
  SeriesRole.STEWARD,
];

/** Roles allowed to rule on appeals. Race control is deliberately excluded
 *  so the officials who issue penalties are not the panel of appeal. */
export const SERIES_APPEAL_ROLES: SeriesRole[] = [
  SeriesRole.OWNER,
  SeriesRole.ADMIN,
  SeriesRole.STEWARD,
];

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

/**
 * Row-level authorization for series-scoped actions. Throws rather than
 * returning a boolean so call sites cannot forget to check the result.
 */
export async function assertSeriesRole(
  db: PrismaClient,
  seriesId: string,
  userId: string,
  allowed: SeriesRole[],
): Promise<SeriesRole> {
  const role = await getSeriesRole(db, seriesId, userId);
  if (!role || !allowed.includes(role)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You do not have permission to manage this series.",
    });
  }
  return role;
}

/**
 * Same check, resolved from an event id. Events that do not belong to a
 * managed series have no organizer chain and are rejected.
 */
export async function assertEventOrganizer(
  db: PrismaClient,
  eventId: string,
  userId: string,
  allowed: SeriesRole[],
): Promise<{ seriesId: string; role: SeriesRole }> {
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
  const role = await assertSeriesRole(db, event.seriesId, userId, allowed);
  return { seriesId: event.seriesId, role };
}

/** Organizer user ids for an event, for notification fan-out. */
export async function eventOrganizerIds(
  db: PrismaClient,
  seriesId: string,
  roles: SeriesRole[] = SERIES_EVENT_ROLES,
): Promise<string[]> {
  const memberships = await db.seriesMembership.findMany({
    where: { seriesId, role: { in: roles } },
    select: { userId: true },
  });
  return memberships.map((m) => m.userId);
}
