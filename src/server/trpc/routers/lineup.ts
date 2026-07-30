import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { LineupRole } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "@/server/trpc/trpc";
import {
  assertEventOrganizer,
  getSeriesRole,
  SERIES_EVENT_ROLES,
} from "@/server/services/series-auth";
import { TEAM_MANAGER_ROLES } from "@/lib/teams";
import { breaches, checkLineup } from "@/lib/lineup";

/**
 * Endurance line-ups: who is declared to drive an entry, and their time in the
 * car.
 *
 * Two parties maintain this. The entrant (a team manager, or the individual who
 * submitted the entry) declares the crew; race control can also log stints and
 * always sees the compliance picture. Drive-time rules live on the event, so a
 * sprint round with no rules set simply has nothing to enforce.
 */

/** Who may edit an entry's line-up: the entrant's side, or race control. */
async function assertCanManageEntry(
  db: PrismaClient,
  registrationId: string,
  userId: string,
): Promise<{ eventId: string; isOrganizer: boolean }> {
  const registration = await db.eventRegistration.findUnique({
    where: { id: registrationId },
    select: {
      eventId: true,
      teamId: true,
      entrantUserId: true,
      submittedById: true,
      event: { select: { seriesId: true } },
    },
  });
  if (!registration) throw new TRPCError({ code: "NOT_FOUND" });

  const role = registration.event.seriesId
    ? await getSeriesRole(db, registration.event.seriesId, userId)
    : null;
  if (role && SERIES_EVENT_ROLES.includes(role)) {
    return { eventId: registration.eventId, isOrganizer: true };
  }

  if (
    registration.submittedById === userId ||
    registration.entrantUserId === userId
  ) {
    return { eventId: registration.eventId, isOrganizer: false };
  }

  if (registration.teamId) {
    const membership = await db.teamMembership.findUnique({
      where: { teamId_userId: { teamId: registration.teamId, userId } },
      select: { role: true, endDate: true },
    });
    if (
      membership &&
      membership.endDate === null &&
      TEAM_MANAGER_ROLES.includes(membership.role)
    ) {
      return { eventId: registration.eventId, isOrganizer: false };
    }
  }

  throw new TRPCError({
    code: "FORBIDDEN",
    message: "Only the entrant or race control can manage this line-up.",
  });
}

/** Loads a line-up with its stints and the event's rules, then checks it. */
async function complianceFor(db: PrismaClient, registrationId: string) {
  const registration = await db.eventRegistration.findUnique({
    where: { id: registrationId },
    include: {
      event: {
        select: {
          id: true,
          minDriversPerEntry: true,
          maxDriversPerEntry: true,
          maxStintMinutes: true,
          minStintMinutes: true,
          maxDriveMinutesPerDriver: true,
          minDriveMinutesPerDriver: true,
          status: true,
        },
      },
      lineup: {
        orderBy: { createdAt: "asc" },
        include: {
          user: {
            select: { id: true, profile: { select: { displayName: true } } },
          },
        },
      },
      stints: { orderBy: { startedAt: "asc" } },
    },
  });
  if (!registration) throw new TRPCError({ code: "NOT_FOUND" });

  const rules = {
    minDriversPerEntry: registration.event.minDriversPerEntry,
    maxDriversPerEntry: registration.event.maxDriversPerEntry,
    maxStintMinutes: registration.event.maxStintMinutes,
    minStintMinutes: registration.event.minStintMinutes,
    maxDriveMinutesPerDriver: registration.event.maxDriveMinutesPerDriver,
    minDriveMinutesPerDriver: registration.event.minDriveMinutesPerDriver,
  };

  const violations = checkLineup({
    lineup: registration.lineup.map((entry) => ({
      id: entry.id,
      userId: entry.userId,
      role: entry.role,
    })),
    stints: registration.stints,
    rules,
    sessionComplete: registration.event.status === "COMPLETED",
  });

  return { registration, rules, violations };
}

export const lineupRouter = createTRPCRouter({
  /**
   * An entry's declared crew, stints and compliance state. Public: who is
   * driving a car is part of the entry list.
   */
  forRegistration: publicProcedure
    .input(z.object({ registrationId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      const { registration, rules, violations } = await complianceFor(
        ctx.db,
        input.registrationId,
      );
      return {
        lineup: registration.lineup,
        stints: registration.stints,
        rules,
        violations,
      };
    }),

  /** Every line-up for an event — the entry list with crews. */
  forEvent: publicProcedure
    .input(z.object({ eventId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.db.eventRegistration.findMany({
        where: { eventId: input.eventId, status: { not: "WITHDRAWN" } },
        orderBy: { carNumber: "asc" },
        select: {
          id: true,
          carNumber: true,
          carClass: true,
          status: true,
          team: { select: { id: true, name: true, slug: true } },
          entrantUser: {
            select: { id: true, profile: { select: { displayName: true } } },
          },
          lineup: {
            orderBy: { createdAt: "asc" },
            include: {
              user: {
                select: { id: true, profile: { select: { displayName: true } } },
              },
            },
          },
        },
      });
    }),

  addDriver: protectedProcedure
    .input(
      z.object({
        registrationId: z.string().cuid(),
        userId: z.string().cuid(),
        role: z.nativeEnum(LineupRole).default(LineupRole.DRIVER),
        grade: z.string().max(40).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertCanManageEntry(ctx.db, input.registrationId, ctx.user.id);

      const target = await ctx.db.user.findUnique({
        where: { id: input.userId },
        select: { id: true },
      });
      if (!target) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "That driver does not have a RaceOps account.",
        });
      }

      // A nomination as driver of record replaces any existing one rather than
      // failing, since that is what the entrant means by nominating.
      if (input.role === LineupRole.DRIVER_OF_RECORD) {
        await ctx.db.registrationDriver.updateMany({
          where: {
            registrationId: input.registrationId,
            role: LineupRole.DRIVER_OF_RECORD,
          },
          data: { role: LineupRole.DRIVER },
        });
      }

      const existing = await ctx.db.registrationDriver.findUnique({
        where: {
          registrationId_userId: {
            registrationId: input.registrationId,
            userId: input.userId,
          },
        },
        select: { id: true },
      });
      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "That driver is already on this entry.",
        });
      }

      return ctx.db.registrationDriver.create({
        data: {
          registrationId: input.registrationId,
          userId: input.userId,
          role: input.role,
          grade: input.grade,
        },
      });
    }),

  setDriverRole: protectedProcedure
    .input(
      z.object({
        lineupDriverId: z.string().cuid(),
        role: z.nativeEnum(LineupRole).optional(),
        grade: z.string().max(40).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const entry = await ctx.db.registrationDriver.findUnique({
        where: { id: input.lineupDriverId },
        select: { id: true, registrationId: true },
      });
      if (!entry) throw new TRPCError({ code: "NOT_FOUND" });
      await assertCanManageEntry(ctx.db, entry.registrationId, ctx.user.id);

      if (input.role === LineupRole.DRIVER_OF_RECORD) {
        await ctx.db.registrationDriver.updateMany({
          where: {
            registrationId: entry.registrationId,
            role: LineupRole.DRIVER_OF_RECORD,
            NOT: { id: entry.id },
          },
          data: { role: LineupRole.DRIVER },
        });
      }

      const { lineupDriverId, ...data } = input;
      return ctx.db.registrationDriver.update({
        where: { id: lineupDriverId },
        data,
      });
    }),

  removeDriver: protectedProcedure
    .input(z.object({ lineupDriverId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const entry = await ctx.db.registrationDriver.findUnique({
        where: { id: input.lineupDriverId },
        select: { id: true, registrationId: true, _count: { select: { stints: true } } },
      });
      if (!entry) throw new TRPCError({ code: "NOT_FOUND" });
      await assertCanManageEntry(ctx.db, entry.registrationId, ctx.user.id);

      // Stints keep their row (SetNull) so the car's history stays intact even
      // though the time can no longer be attributed to a driver.
      await ctx.db.registrationDriver.delete({ where: { id: entry.id } });
      return { deleted: true, orphanedStints: entry._count.stints };
    }),

  // -------------------------------------------------------------------------
  // Drive time
  // -------------------------------------------------------------------------

  /** Event-level line-up regulations. Organizers only. */
  setRules: protectedProcedure
    .input(
      z.object({
        eventId: z.string().cuid(),
        minDriversPerEntry: z.number().int().min(1).max(20).nullish(),
        maxDriversPerEntry: z.number().int().min(1).max(20).nullish(),
        maxStintMinutes: z.number().int().min(1).max(1440).nullish(),
        minStintMinutes: z.number().int().min(1).max(1440).nullish(),
        maxDriveMinutesPerDriver: z.number().int().min(1).max(10080).nullish(),
        minDriveMinutesPerDriver: z.number().int().min(1).max(10080).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { eventId, ...data } = input;
      await assertEventOrganizer(ctx.db, eventId, ctx.user.id, SERIES_EVENT_ROLES);

      const event = await ctx.db.raceEvent.findUniqueOrThrow({
        where: { id: eventId },
        select: {
          minDriversPerEntry: true,
          maxDriversPerEntry: true,
          minStintMinutes: true,
          maxStintMinutes: true,
          minDriveMinutesPerDriver: true,
          maxDriveMinutesPerDriver: true,
        },
      });
      const merged = { ...event, ...data };

      // Contradictory rules would make every entry permanently non-compliant.
      if (
        merged.minDriversPerEntry != null &&
        merged.maxDriversPerEntry != null &&
        merged.minDriversPerEntry > merged.maxDriversPerEntry
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Minimum drivers cannot exceed the maximum.",
        });
      }
      if (
        merged.minStintMinutes != null &&
        merged.maxStintMinutes != null &&
        merged.minStintMinutes > merged.maxStintMinutes
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Minimum stint cannot exceed the maximum stint.",
        });
      }
      if (
        merged.minDriveMinutesPerDriver != null &&
        merged.maxDriveMinutesPerDriver != null &&
        merged.minDriveMinutesPerDriver > merged.maxDriveMinutesPerDriver
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Minimum drive time cannot exceed the maximum.",
        });
      }

      return ctx.db.raceEvent.update({ where: { id: eventId }, data });
    }),

  /** Put a driver in the car. Closes any stint still open on that entry. */
  startStint: protectedProcedure
    .input(
      z.object({
        lineupDriverId: z.string().cuid(),
        sessionId: z.string().cuid().optional(),
        startedAt: z.date().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const entry = await ctx.db.registrationDriver.findUnique({
        where: { id: input.lineupDriverId },
        select: { id: true, registrationId: true },
      });
      if (!entry) throw new TRPCError({ code: "NOT_FOUND" });
      await assertCanManageEntry(ctx.db, entry.registrationId, ctx.user.id);

      const startedAt = input.startedAt ?? new Date();

      // Only one driver can be in the car, so a driver change implicitly ends
      // the previous stint — forgetting to close it is the common mistake.
      await ctx.db.stint.updateMany({
        where: { registrationId: entry.registrationId, endedAt: null },
        data: { endedAt: startedAt },
      });

      return ctx.db.stint.create({
        data: {
          registrationId: entry.registrationId,
          lineupDriverId: entry.id,
          sessionId: input.sessionId,
          startedAt,
        },
      });
    }),

  endStint: protectedProcedure
    .input(
      z.object({
        stintId: z.string().cuid(),
        endedAt: z.date().optional(),
        laps: z.number().int().min(0).max(10000).optional(),
        notes: z.string().max(2000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const stint = await ctx.db.stint.findUnique({
        where: { id: input.stintId },
        select: { id: true, registrationId: true, startedAt: true },
      });
      if (!stint) throw new TRPCError({ code: "NOT_FOUND" });
      await assertCanManageEntry(ctx.db, stint.registrationId, ctx.user.id);

      const endedAt = input.endedAt ?? new Date();
      if (endedAt <= stint.startedAt) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "A stint cannot end before it started.",
        });
      }

      return ctx.db.stint.update({
        where: { id: stint.id },
        data: { endedAt, laps: input.laps, notes: input.notes },
      });
    }),

  removeStint: protectedProcedure
    .input(z.object({ stintId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const stint = await ctx.db.stint.findUnique({
        where: { id: input.stintId },
        select: { id: true, registrationId: true },
      });
      if (!stint) throw new TRPCError({ code: "NOT_FOUND" });
      await assertCanManageEntry(ctx.db, stint.registrationId, ctx.user.id);
      await ctx.db.stint.delete({ where: { id: stint.id } });
      return { deleted: true };
    }),

  /**
   * Every entry's compliance state for an event — race control's view of who
   * is about to break a drive-time rule. Organizers only, since it is a
   * regulatory working view rather than a published record.
   */
  complianceForEvent: protectedProcedure
    .input(z.object({ eventId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      await assertEventOrganizer(
        ctx.db,
        input.eventId,
        ctx.user.id,
        SERIES_EVENT_ROLES,
      );
      const registrations = await ctx.db.eventRegistration.findMany({
        where: { eventId: input.eventId, status: "CONFIRMED" },
        select: { id: true, carNumber: true, team: { select: { name: true } } },
        orderBy: { carNumber: "asc" },
      });

      const rows = [];
      for (const registration of registrations) {
        const { violations } = await complianceFor(ctx.db, registration.id);
        rows.push({
          registrationId: registration.id,
          carNumber: registration.carNumber,
          teamName: registration.team?.name ?? null,
          violations,
          breachCount: breaches(violations).length,
        });
      }
      return rows;
    }),
});
