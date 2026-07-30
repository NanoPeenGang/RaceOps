import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { Prisma, TireSetStatus } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import {
  createTRPCRouter,
  protectedProcedure,
  publicProcedure,
} from "@/server/trpc/trpc";
import {
  assertEventOrganizer,
  assertSeriesRole,
  SERIES_ADMIN_ROLES,
  SERIES_EVENT_ROLES,
} from "@/server/services/series-auth";
import { TEAM_MANAGER_ROLES } from "@/lib/teams";
import {
  normalizeTransponderNumber,
  tireAllocation,
  transponderIndex,
} from "@/lib/cars";

/**
 * Cars, transponders and tire allocation.
 *
 * Cars and transponders belong to competitors; tire sets are issued by
 * officials. The authorization split follows that: a team manages its own
 * fleet, and only race control marks tires.
 */

/** Throws unless the caller manages the team, or owns the car personally. */
async function assertCarOwner(
  db: PrismaClient,
  carId: string,
  userId: string,
): Promise<void> {
  const car = await db.car.findUnique({
    where: { id: carId },
    select: { teamId: true, ownerUserId: true },
  });
  if (!car) throw new TRPCError({ code: "NOT_FOUND" });
  if (car.ownerUserId === userId) return;
  if (car.teamId) {
    await assertTeamManager(db, car.teamId, userId);
    return;
  }
  throw new TRPCError({ code: "FORBIDDEN", message: "This is not your car." });
}

async function assertTeamManager(
  db: PrismaClient,
  teamId: string,
  userId: string,
): Promise<void> {
  const membership = await db.teamMembership.findUnique({
    where: { teamId_userId: { teamId, userId } },
    select: { role: true, endDate: true },
  });
  if (
    !membership ||
    membership.endDate !== null ||
    !TEAM_MANAGER_ROLES.includes(membership.role)
  ) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only the team's owner or a manager can do that.",
    });
  }
}

/** Whether the caller may act for an entry — the entrant or a team manager. */
async function assertCanActForRegistration(
  db: PrismaClient,
  registrationId: string,
  userId: string,
): Promise<{ eventId: string; teamId: string | null }> {
  const registration = await db.eventRegistration.findUnique({
    where: { id: registrationId },
    select: {
      eventId: true,
      teamId: true,
      entrantUserId: true,
      submittedById: true,
    },
  });
  if (!registration) throw new TRPCError({ code: "NOT_FOUND" });
  if (
    registration.submittedById === userId ||
    registration.entrantUserId === userId
  ) {
    return { eventId: registration.eventId, teamId: registration.teamId };
  }
  if (registration.teamId) {
    await assertTeamManager(db, registration.teamId, userId);
    return { eventId: registration.eventId, teamId: registration.teamId };
  }
  throw new TRPCError({
    code: "FORBIDDEN",
    message: "You cannot act for that entry.",
  });
}

export const carRouter = createTRPCRouter({
  // -- Cars ----------------------------------------------------------------

  /** Every car the caller can enter: their own, plus their teams'. */
  mine: protectedProcedure.query(async ({ ctx }) => {
    const memberships = await ctx.db.teamMembership.findMany({
      where: { userId: ctx.user.id, endDate: null },
      select: { teamId: true },
    });
    return ctx.db.car.findMany({
      where: {
        OR: [
          { ownerUserId: ctx.user.id },
          { teamId: { in: memberships.map((m) => m.teamId) } },
        ],
      },
      orderBy: [{ active: "desc" }, { name: "asc" }],
      include: {
        team: { select: { id: true, name: true, slug: true } },
        _count: { select: { registrations: true } },
      },
    });
  }),

  forTeam: publicProcedure
    .input(z.object({ teamId: z.string().cuid() }))
    .query(({ ctx, input }) =>
      ctx.db.car.findMany({
        where: { teamId: input.teamId },
        orderBy: [{ active: "desc" }, { name: "asc" }],
        include: { _count: { select: { registrations: true } } },
      }),
    ),

  /** A car's race history — the reason cars are entities and not free text. */
  byId: publicProcedure
    .input(z.object({ carId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      const car = await ctx.db.car.findUnique({
        where: { id: input.carId },
        include: {
          team: { select: { id: true, name: true, slug: true } },
          ownerUser: {
            select: { id: true, profile: { select: { displayName: true } } },
          },
          registrations: {
            orderBy: { event: { date: "desc" } },
            select: {
              id: true,
              carNumber: true,
              status: true,
              event: {
                select: {
                  id: true,
                  name: true,
                  date: true,
                  series: { select: { name: true, slug: true } },
                },
              },
              team: { select: { id: true, name: true } },
              result: { select: { finishPosition: true, status: true } },
            },
          },
        },
      });
      if (!car) throw new TRPCError({ code: "NOT_FOUND" });
      return car;
    }),

  create: protectedProcedure
    .input(
      z.object({
        // Exactly one owner; the database enforces it too.
        teamId: z.string().cuid().optional(),
        name: z.string().min(1).max(80),
        make: z.string().max(60).optional(),
        model: z.string().max(60).optional(),
        year: z.number().int().min(1885).max(2100).optional(),
        chassisNumber: z.string().max(60).optional(),
        engine: z.string().max(80).optional(),
        homologation: z.string().max(60).optional(),
        classLabel: z.string().max(60).optional(),
        liveryUrl: z.string().url().max(300).optional(),
        notes: z.string().max(2000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { teamId, ...rest } = input;
      if (teamId) await assertTeamManager(ctx.db, teamId, ctx.user.id);
      return ctx.db.car.create({
        data: {
          ...rest,
          teamId: teamId ?? null,
          ownerUserId: teamId ? null : ctx.user.id,
          createdById: ctx.user.id,
        },
      });
    }),

  update: protectedProcedure
    .input(
      z.object({
        carId: z.string().cuid(),
        name: z.string().min(1).max(80).optional(),
        make: z.string().max(60).nullish(),
        model: z.string().max(60).nullish(),
        year: z.number().int().min(1885).max(2100).nullish(),
        chassisNumber: z.string().max(60).nullish(),
        engine: z.string().max(80).nullish(),
        homologation: z.string().max(60).nullish(),
        classLabel: z.string().max(60).nullish(),
        liveryUrl: z.string().url().max(300).nullish(),
        notes: z.string().max(2000).nullish(),
        active: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { carId, ...data } = input;
      await assertCarOwner(ctx.db, carId, ctx.user.id);
      return ctx.db.car.update({ where: { id: carId }, data });
    }),

  delete: protectedProcedure
    .input(z.object({ carId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertCarOwner(ctx.db, input.carId, ctx.user.id);
      const entered = await ctx.db.eventRegistration.count({
        where: { carId: input.carId },
      });
      if (entered > 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `This car has ${entered} entr${entered === 1 ? "y" : "ies"} against it. Mark it inactive instead — deleting it would detach the results.`,
        });
      }
      await ctx.db.car.delete({ where: { id: input.carId } });
      return { deleted: true };
    }),

  /**
   * What one entry has declared: car, transponders, tire allocation.
   * Restricted to the entry's own people — a transponder number is what a
   * timing feed keys on, and publishing the map would let anyone spoof it.
   */
  forRegistration: protectedProcedure
    .input(z.object({ registrationId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      await assertCanActForRegistration(
        ctx.db,
        input.registrationId,
        ctx.user.id,
      );
      const registration = await ctx.db.eventRegistration.findUniqueOrThrow({
        where: { id: input.registrationId },
        select: {
          carId: true,
          car: true,
          transponders: {
            orderBy: { isPrimary: "desc" },
            include: { transponder: true },
          },
        },
      });
      return registration;
    }),

  /** Puts a car on an entry, or takes it off. */
  setEntryCar: protectedProcedure
    .input(
      z.object({
        registrationId: z.string().cuid(),
        carId: z.string().cuid().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertCanActForRegistration(
        ctx.db,
        input.registrationId,
        ctx.user.id,
      );
      // Entering someone else's car would put their chassis in your results.
      if (input.carId) await assertCarOwner(ctx.db, input.carId, ctx.user.id);
      return ctx.db.eventRegistration.update({
        where: { id: input.registrationId },
        data: { carId: input.carId },
      });
    }),

  // -- Transponders --------------------------------------------------------

  /** Transponders the caller can assign: their own, their teams', and pools. */
  myTransponders: protectedProcedure.query(async ({ ctx }) => {
    const memberships = await ctx.db.teamMembership.findMany({
      where: { userId: ctx.user.id, endDate: null },
      select: { teamId: true },
    });
    return ctx.db.transponder.findMany({
      where: {
        OR: [
          { ownerUserId: ctx.user.id },
          { teamId: { in: memberships.map((m) => m.teamId) } },
        ],
      },
      orderBy: [{ active: "desc" }, { number: "asc" }],
      include: { team: { select: { id: true, name: true } } },
    });
  }),

  /** A series' rental pool, with what each unit is currently fitted to. */
  seriesTransponders: protectedProcedure
    .input(z.object({ seriesId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      await assertSeriesRole(
        ctx.db,
        input.seriesId,
        ctx.user.id,
        SERIES_EVENT_ROLES,
      );
      return ctx.db.transponder.findMany({
        where: { seriesId: input.seriesId },
        orderBy: [{ active: "desc" }, { number: "asc" }],
        include: {
          assignments: {
            orderBy: { assignedAt: "desc" },
            take: 1,
            include: {
              registration: {
                select: {
                  id: true,
                  carNumber: true,
                  event: { select: { id: true, name: true, date: true } },
                  team: { select: { name: true } },
                },
              },
            },
          },
        },
      });
    }),

  registerTransponder: protectedProcedure
    .input(
      z.object({
        number: z.string().min(1).max(40),
        make: z.string().max(60).optional(),
        /// Owned by a team, a series pool, or the caller when neither is set.
        teamId: z.string().cuid().optional(),
        seriesId: z.string().cuid().optional(),
        notes: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { teamId, seriesId, number, ...rest } = input;
      if (teamId) await assertTeamManager(ctx.db, teamId, ctx.user.id);
      if (seriesId) {
        await assertSeriesRole(
          ctx.db,
          seriesId,
          ctx.user.id,
          SERIES_ADMIN_ROLES,
        );
      }
      // Numbers are stored normalized so a feed that writes "TR-123 456"
      // still resolves to the unit registered as "123456".
      const normalized = normalizeTransponderNumber(number);
      if (!normalized) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "That is not a transponder number.",
        });
      }
      try {
        return await ctx.db.transponder.create({
          data: {
            ...rest,
            number: normalized,
            teamId: teamId ?? null,
            seriesId: seriesId ?? null,
            ownerUserId: teamId || seriesId ? null : ctx.user.id,
          },
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `Transponder ${normalized} is already registered. Transponder numbers are unique to one physical unit.`,
          });
        }
        throw error;
      }
    }),

  /** Fits a transponder to an entry for this event. */
  assignTransponder: protectedProcedure
    .input(
      z.object({
        registrationId: z.string().cuid(),
        transponderId: z.string().cuid(),
        isPrimary: z.boolean().default(true),
        notes: z.string().max(200).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { eventId } = await assertCanActForRegistration(
        ctx.db,
        input.registrationId,
        ctx.user.id,
      );

      // A unit fitted to two cars in the same session makes the timing feed
      // ambiguous, which is exactly the failure transponders exist to avoid.
      const clash = await ctx.db.transponderAssignment.findFirst({
        where: {
          transponderId: input.transponderId,
          registration: { eventId },
          registrationId: { not: input.registrationId },
        },
        select: { registration: { select: { carNumber: true } } },
      });
      if (clash) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `That transponder is already fitted to another entry at this event${clash.registration.carNumber ? ` (#${clash.registration.carNumber})` : ""}.`,
        });
      }

      // One primary per entry is a partial unique index, so the demote and the
      // promote have to land together.
      const writes: Prisma.PrismaPromise<unknown>[] = [];
      if (input.isPrimary) {
        writes.push(
          ctx.db.transponderAssignment.updateMany({
            where: { registrationId: input.registrationId, isPrimary: true },
            data: { isPrimary: false },
          }),
        );
      }
      writes.push(
        ctx.db.transponderAssignment.upsert({
          where: {
            registrationId_transponderId: {
              registrationId: input.registrationId,
              transponderId: input.transponderId,
            },
          },
          create: {
            registrationId: input.registrationId,
            transponderId: input.transponderId,
            isPrimary: input.isPrimary,
            notes: input.notes,
          },
          update: { isPrimary: input.isPrimary, notes: input.notes },
        }),
      );
      await ctx.db.$transaction(writes);

      return ctx.db.transponderAssignment.findMany({
        where: { registrationId: input.registrationId },
        include: { transponder: true },
      });
    }),

  removeTransponder: protectedProcedure
    .input(z.object({ assignmentId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const assignment = await ctx.db.transponderAssignment.findUnique({
        where: { id: input.assignmentId },
        select: { registrationId: true },
      });
      if (!assignment) throw new TRPCError({ code: "NOT_FOUND" });
      await assertCanActForRegistration(
        ctx.db,
        assignment.registrationId,
        ctx.user.id,
      );
      await ctx.db.transponderAssignment.delete({
        where: { id: input.assignmentId },
      });
      return { removed: true };
    }),

  /**
   * Transponder number -> entry for an event.
   *
   * This is what a real timing system needs: it emits transponder numbers, and
   * RaceOps keys timing on registrations. Officials only, since it maps a
   * physical unit to a competitor.
   */
  transponderMap: protectedProcedure
    .input(z.object({ eventId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      await assertEventOrganizer(
        ctx.db,
        input.eventId,
        ctx.user.id,
        SERIES_EVENT_ROLES,
      );
      const assignments = await ctx.db.transponderAssignment.findMany({
        where: { registration: { eventId: input.eventId } },
        select: {
          registrationId: true,
          isPrimary: true,
          transponder: { select: { number: true } },
        },
      });
      const index = transponderIndex(assignments);
      return {
        entries: [...index.entries()].map(([number, registrationId]) => ({
          number,
          registrationId,
        })),
        unassigned: await ctx.db.eventRegistration.count({
          where: {
            eventId: input.eventId,
            status: "CONFIRMED",
            transponders: { none: {} },
          },
        }),
      };
    }),

  // -- Tire sets -----------------------------------------------------------

  /** Every set issued at an event, grouped by entry. Officials only. */
  tireSetsForEvent: protectedProcedure
    .input(z.object({ eventId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      await assertEventOrganizer(
        ctx.db,
        input.eventId,
        ctx.user.id,
        SERIES_EVENT_ROLES,
      );
      const event = await ctx.db.raceEvent.findUniqueOrThrow({
        where: { id: input.eventId },
        select: { tireSetAllowance: true },
      });
      const registrations = await ctx.db.eventRegistration.findMany({
        where: { eventId: input.eventId, status: "CONFIRMED" },
        orderBy: { carNumber: "asc" },
        select: {
          id: true,
          carNumber: true,
          team: { select: { name: true } },
          entrantUser: {
            select: { profile: { select: { displayName: true } } },
          },
          tireSets: { orderBy: { allocatedAt: "asc" } },
        },
      });
      return {
        allowance: event.tireSetAllowance,
        entries: registrations.map((registration) => ({
          registrationId: registration.id,
          carNumber: registration.carNumber,
          label:
            registration.team?.name ??
            registration.entrantUser?.profile?.displayName ??
            "Entry",
          sets: registration.tireSets,
          allocation: tireAllocation(
            registration.tireSets,
            event.tireSetAllowance,
          ),
        })),
      };
    }),

  /** Issue a set. Officials only — a competitor cannot allocate their own. */
  allocateTireSet: protectedProcedure
    .input(
      z.object({
        registrationId: z.string().cuid(),
        identifier: z.string().min(1).max(60),
        compound: z.string().max(40).optional(),
        dimension: z.string().max(40).optional(),
        notes: z.string().max(300).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const registration = await ctx.db.eventRegistration.findUnique({
        where: { id: input.registrationId },
        select: { eventId: true },
      });
      if (!registration) throw new TRPCError({ code: "NOT_FOUND" });
      await assertEventOrganizer(
        ctx.db,
        registration.eventId,
        ctx.user.id,
        SERIES_EVENT_ROLES,
      );

      const { registrationId, ...rest } = input;
      try {
        return await ctx.db.tireSet.create({
          data: {
            ...rest,
            registrationId,
            eventId: registration.eventId,
            allocatedById: ctx.user.id,
          },
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `Set ${input.identifier} has already been issued at this event.`,
          });
        }
        throw error;
      }
    }),

  setTireStatus: protectedProcedure
    .input(
      z.object({
        tireSetId: z.string().cuid(),
        status: z.nativeEnum(TireSetStatus),
        notes: z.string().max(300).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const set = await ctx.db.tireSet.findUnique({
        where: { id: input.tireSetId },
        select: { eventId: true },
      });
      if (!set) throw new TRPCError({ code: "NOT_FOUND" });
      await assertEventOrganizer(
        ctx.db,
        set.eventId,
        ctx.user.id,
        SERIES_EVENT_ROLES,
      );
      return ctx.db.tireSet.update({
        where: { id: input.tireSetId },
        data: { status: input.status, notes: input.notes },
      });
    }),

  /** An entry's own view of its allocation. */
  myTireAllocation: protectedProcedure
    .input(z.object({ registrationId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      await assertCanActForRegistration(
        ctx.db,
        input.registrationId,
        ctx.user.id,
      );
      const registration = await ctx.db.eventRegistration.findUniqueOrThrow({
        where: { id: input.registrationId },
        select: {
          tireSets: { orderBy: { allocatedAt: "asc" } },
          event: { select: { tireSetAllowance: true } },
        },
      });
      return {
        sets: registration.tireSets,
        allocation: tireAllocation(
          registration.tireSets,
          registration.event.tireSetAllowance,
        ),
      };
    }),
});
