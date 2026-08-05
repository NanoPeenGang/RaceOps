import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  GarageFileKind,
  PartCategory,
  ServiceKind,
  ServiceStatus,
  StockMoveKind,
  TeamRole,
} from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { createTRPCRouter, protectedProcedure } from "@/server/trpc/trpc";
import { TEAM_MANAGER_ROLES } from "@/lib/teams";
import { balanceAfter, checkMovement, deltaFor } from "@/lib/inventory";
import { upcomingServices } from "@/lib/service";
import { seatTimeByDriver, type SeasonStint } from "@/lib/seat-time";

/**
 * The garage: parts stock, telemetry and setup files, and car servicing.
 *
 * Two levels of authorization, and the split is deliberate. Reading the
 * garage is for the whole roster — a driver should be able to find the setup
 * they ran last time without asking a manager. Changing stock and logging
 * work is for the people who actually run the car: managers, engineers and
 * crew. Drivers are readers here, which is not a slight; it is that a driver
 * marking a part consumed from the paddock is how a count stops matching the
 * shelf.
 */

/** Roles that may change what is in the garage. */
const GARAGE_WRITE_ROLES: readonly TeamRole[] = [
  TeamRole.OWNER,
  TeamRole.MANAGER,
  TeamRole.ENGINEER,
  TeamRole.CREW,
];

interface TeamStanding {
  role: TeamRole;
  canWrite: boolean;
  canManage: boolean;
}

/** Throws unless the caller is on the team's current roster. */
async function assertGarageRead(
  db: PrismaClient,
  teamId: string,
  userId: string,
): Promise<TeamStanding> {
  const membership = await db.teamMembership.findUnique({
    where: { teamId_userId: { teamId, userId } },
    select: { role: true, endDate: true },
  });
  if (!membership || membership.endDate !== null) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "The garage is for the team's current members.",
    });
  }
  return {
    role: membership.role,
    canWrite: GARAGE_WRITE_ROLES.includes(membership.role),
    canManage: TEAM_MANAGER_ROLES.includes(membership.role),
  };
}

async function assertGarageWrite(
  db: PrismaClient,
  teamId: string,
  userId: string,
): Promise<TeamStanding> {
  const standing = await assertGarageRead(db, teamId, userId);
  if (!standing.canWrite) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "Managers, engineers and crew keep the garage records. Ask one of them to log this.",
    });
  }
  return standing;
}

/** The team a car belongs to, refusing cars that belong to no team. */
async function teamForCar(db: PrismaClient, carId: string): Promise<string> {
  const car = await db.car.findUnique({
    where: { id: carId },
    select: { teamId: true },
  });
  if (!car) throw new TRPCError({ code: "NOT_FOUND" });
  if (!car.teamId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "That car is not on a team, so it has no garage.",
    });
  }
  return car.teamId;
}

const moneySchema = z.number().int().min(0).max(100_000_000).nullish();

export const garageRouter = createTRPCRouter({
  // -- Inventory -----------------------------------------------------------

  inventory: protectedProcedure
    .input(
      z.object({
        teamId: z.string().cuid(),
        includeRetired: z.boolean().default(false),
      }),
    )
    .query(async ({ ctx, input }) => {
      const standing = await assertGarageRead(ctx.db, input.teamId, ctx.user.id);
      const items = await ctx.db.inventoryItem.findMany({
        where: {
          teamId: input.teamId,
          ...(input.includeRetired ? {} : { active: true }),
        },
        orderBy: [{ category: "asc" }, { name: "asc" }],
        include: {
          car: { select: { id: true, name: true } },
          _count: { select: { movements: true } },
        },
      });
      return { items, canWrite: standing.canWrite };
    }),

  addItem: protectedProcedure
    .input(
      z.object({
        teamId: z.string().cuid(),
        name: z.string().min(1).max(160),
        partNumber: z.string().max(80).nullish(),
        category: z.nativeEnum(PartCategory).default(PartCategory.OTHER),
        location: z.string().max(120).nullish(),
        unit: z.string().min(1).max(24).default("each"),
        /// Opening count. Recorded as a RECEIVED movement, not written
        /// straight to the balance, so the ledger starts where the shelf does.
        quantity: z.number().int().min(0).max(1_000_000).default(0),
        minQuantity: z.number().int().min(0).max(1_000_000).nullish(),
        unitCostMinor: moneySchema,
        currency: z.string().length(3).default("USD"),
        supplier: z.string().max(160).nullish(),
        carId: z.string().cuid().nullish(),
        notes: z.string().max(2000).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertGarageWrite(ctx.db, input.teamId, ctx.user.id);
      const { quantity, ...rest } = input;

      return ctx.db.$transaction(async (tx) => {
        const item = await tx.inventoryItem.create({
          data: { ...rest, quantity, createdById: ctx.user.id },
        });
        if (quantity > 0) {
          await tx.inventoryMovement.create({
            data: {
              itemId: item.id,
              kind: StockMoveKind.RECEIVED,
              delta: quantity,
              balance: quantity,
              reason: "Opening count",
              userId: ctx.user.id,
            },
          });
        }
        return item;
      });
    }),

  updateItem: protectedProcedure
    .input(
      z.object({
        itemId: z.string().cuid(),
        name: z.string().min(1).max(160).optional(),
        partNumber: z.string().max(80).nullish(),
        category: z.nativeEnum(PartCategory).optional(),
        location: z.string().max(120).nullish(),
        unit: z.string().min(1).max(24).optional(),
        minQuantity: z.number().int().min(0).max(1_000_000).nullish(),
        unitCostMinor: moneySchema,
        currency: z.string().length(3).optional(),
        supplier: z.string().max(160).nullish(),
        carId: z.string().cuid().nullish(),
        notes: z.string().max(2000).nullish(),
        active: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { itemId, ...data } = input;
      const item = await ctx.db.inventoryItem.findUnique({
        where: { id: itemId },
        select: { teamId: true },
      });
      if (!item) throw new TRPCError({ code: "NOT_FOUND" });
      await assertGarageWrite(ctx.db, item.teamId, ctx.user.id);

      /*
       * `quantity` is deliberately absent from this input. The count only
       * moves through `recordMovement`, so there is no path that changes a
       * balance without leaving a ledger line explaining it.
       */
      return ctx.db.inventoryItem.update({ where: { id: itemId }, data });
    }),

  /**
   * Moves stock and writes the ledger line, in one transaction.
   *
   * The two must not come apart: a balance without its movement is a number
   * nobody can explain, and a movement without its balance is a ledger that
   * does not add up to the shelf.
   */
  recordMovement: protectedProcedure
    .input(
      z.object({
        itemId: z.string().cuid(),
        kind: z.nativeEnum(StockMoveKind),
        /// Always positive. For ADJUSTED this is the new count, not a change.
        amount: z.number().int().min(0).max(1_000_000),
        reason: z.string().max(300).nullish(),
        eventId: z.string().cuid().nullish(),
        serviceId: z.string().cuid().nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const item = await ctx.db.inventoryItem.findUnique({
        where: { id: input.itemId },
        select: { teamId: true, quantity: true, minQuantity: true },
      });
      if (!item) throw new TRPCError({ code: "NOT_FOUND" });
      await assertGarageWrite(ctx.db, item.teamId, ctx.user.id);

      const delta = deltaFor(input.kind, input.amount, item.quantity);
      const rejection = checkMovement(item, delta);
      if (rejection) {
        throw new TRPCError({ code: "BAD_REQUEST", message: rejection.message });
      }
      const balance = balanceAfter(item, delta);

      return ctx.db.$transaction(async (tx) => {
        const movement = await tx.inventoryMovement.create({
          data: {
            itemId: input.itemId,
            kind: input.kind,
            delta,
            balance,
            reason: input.reason ?? null,
            eventId: input.eventId ?? null,
            serviceId: input.serviceId ?? null,
            userId: ctx.user.id,
          },
        });
        await tx.inventoryItem.update({
          where: { id: input.itemId },
          data: { quantity: balance },
        });
        return movement;
      });
    }),

  /** The ledger for one line, newest first. */
  movements: protectedProcedure
    .input(
      z.object({
        itemId: z.string().cuid(),
        limit: z.number().int().min(1).max(200).default(50),
      }),
    )
    .query(async ({ ctx, input }) => {
      const item = await ctx.db.inventoryItem.findUnique({
        where: { id: input.itemId },
        select: { teamId: true },
      });
      if (!item) throw new TRPCError({ code: "NOT_FOUND" });
      await assertGarageRead(ctx.db, item.teamId, ctx.user.id);

      return ctx.db.inventoryMovement.findMany({
        where: { itemId: input.itemId },
        orderBy: { createdAt: "desc" },
        take: input.limit,
        include: {
          user: {
            select: { id: true, profile: { select: { displayName: true } } },
          },
          event: { select: { id: true, name: true } },
        },
      });
    }),

  // -- Telemetry, setups and documents -------------------------------------

  files: protectedProcedure
    .input(
      z.object({
        teamId: z.string().cuid(),
        kind: z.nativeEnum(GarageFileKind).optional(),
        carId: z.string().cuid().optional(),
        trackLayoutId: z.string().cuid().optional(),
        limit: z.number().int().min(1).max(200).default(100),
      }),
    )
    .query(async ({ ctx, input }) => {
      const standing = await assertGarageRead(ctx.db, input.teamId, ctx.user.id);
      const files = await ctx.db.garageFile.findMany({
        where: {
          teamId: input.teamId,
          ...(input.kind ? { kind: input.kind } : {}),
          ...(input.carId ? { carId: input.carId } : {}),
          ...(input.trackLayoutId
            ? { trackLayoutId: input.trackLayoutId }
            : {}),
        },
        orderBy: { createdAt: "desc" },
        take: input.limit,
        include: {
          car: { select: { id: true, name: true } },
          event: { select: { id: true, name: true, date: true } },
          trackLayout: {
            select: {
              id: true,
              name: true,
              track: { select: { id: true, name: true } },
            },
          },
          driver: {
            select: { id: true, profile: { select: { displayName: true } } },
          },
          uploadedBy: {
            select: { id: true, profile: { select: { displayName: true } } },
          },
        },
      });
      return { files, canWrite: standing.canWrite };
    }),

  addFile: protectedProcedure
    .input(
      z.object({
        teamId: z.string().cuid(),
        kind: z.nativeEnum(GarageFileKind),
        name: z.string().min(1).max(200),
        url: z.string().url().max(2000),
        fileName: z.string().max(255).nullish(),
        contentType: z.string().max(120).nullish(),
        sizeBytes: z.number().int().min(0).nullish(),
        carId: z.string().cuid().nullish(),
        eventId: z.string().cuid().nullish(),
        sessionId: z.string().cuid().nullish(),
        trackLayoutId: z.string().cuid().nullish(),
        driverUserId: z.string().cuid().nullish(),
        conditions: z.string().max(200).nullish(),
        bestLapMs: z.number().int().min(1).max(3_600_000).nullish(),
        notes: z.string().max(4000).nullish(),
        tags: z.array(z.string().min(1).max(40)).max(12).default([]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertGarageWrite(ctx.db, input.teamId, ctx.user.id);
      return ctx.db.garageFile.create({
        data: { ...input, uploadedById: ctx.user.id },
      });
    }),

  updateFile: protectedProcedure
    .input(
      z.object({
        fileId: z.string().cuid(),
        name: z.string().min(1).max(200).optional(),
        carId: z.string().cuid().nullish(),
        eventId: z.string().cuid().nullish(),
        sessionId: z.string().cuid().nullish(),
        trackLayoutId: z.string().cuid().nullish(),
        driverUserId: z.string().cuid().nullish(),
        conditions: z.string().max(200).nullish(),
        bestLapMs: z.number().int().min(1).max(3_600_000).nullish(),
        notes: z.string().max(4000).nullish(),
        tags: z.array(z.string().min(1).max(40)).max(12).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { fileId, ...data } = input;
      const file = await ctx.db.garageFile.findUnique({
        where: { id: fileId },
        select: { teamId: true },
      });
      if (!file) throw new TRPCError({ code: "NOT_FOUND" });
      await assertGarageWrite(ctx.db, file.teamId, ctx.user.id);
      return ctx.db.garageFile.update({ where: { id: fileId }, data });
    }),

  /** Removing a file is a manager's call — a setup nobody can find is lost. */
  removeFile: protectedProcedure
    .input(z.object({ fileId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const file = await ctx.db.garageFile.findUnique({
        where: { id: input.fileId },
        select: { teamId: true, uploadedById: true },
      });
      if (!file) throw new TRPCError({ code: "NOT_FOUND" });
      const standing = await assertGarageWrite(
        ctx.db,
        file.teamId,
        ctx.user.id,
      );
      if (!standing.canManage && file.uploadedById !== ctx.user.id) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only the person who uploaded it or a manager can remove it.",
        });
      }
      await ctx.db.garageFile.delete({ where: { id: input.fileId } });
      return { deleted: true };
    }),

  // -- Servicing -----------------------------------------------------------

  /** Every service record for a team's cars, with what is coming due. */
  services: protectedProcedure
    .input(
      z.object({
        teamId: z.string().cuid(),
        carId: z.string().cuid().optional(),
        status: z.nativeEnum(ServiceStatus).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const standing = await assertGarageRead(ctx.db, input.teamId, ctx.user.id);
      const cars = await ctx.db.car.findMany({
        where: {
          teamId: input.teamId,
          ...(input.carId ? { id: input.carId } : {}),
        },
        select: {
          id: true,
          name: true,
          runningHours: true,
          services: {
            where: input.status ? { status: input.status } : {},
            orderBy: [{ status: "asc" }, { nextDueOn: "asc" }],
            include: {
              event: { select: { id: true, name: true, date: true } },
              performedBy: {
                select: { id: true, profile: { select: { displayName: true } } },
              },
              _count: { select: { partsUsed: true } },
            },
          },
        },
        orderBy: { name: "asc" },
      });

      return {
        canWrite: standing.canWrite,
        cars: cars.map((car) => ({
          ...car,
          // Computed here rather than in the client so the console and any
          // future digest agree on what "overdue" means.
          due: upcomingServices(car.services, car.runningHours),
        })),
      };
    }),

  logService: protectedProcedure
    .input(
      z.object({
        carId: z.string().cuid(),
        kind: z.nativeEnum(ServiceKind).default(ServiceKind.SCHEDULED),
        status: z.nativeEnum(ServiceStatus).default(ServiceStatus.PLANNED),
        component: z.string().min(1).max(160),
        description: z.string().max(4000).nullish(),
        hoursAtService: z.number().min(0).max(100_000).nullish(),
        eventId: z.string().cuid().nullish(),
        performedById: z.string().cuid().nullish(),
        performedOn: z.date().nullish(),
        costMinor: moneySchema,
        currency: z.string().length(3).default("USD"),
        nextDueOn: z.date().nullish(),
        nextDueHours: z.number().min(0).max(100_000).nullish(),
        notes: z.string().max(4000).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const teamId = await teamForCar(ctx.db, input.carId);
      await assertGarageWrite(ctx.db, teamId, ctx.user.id);
      return ctx.db.carService.create({
        data: { ...input, createdById: ctx.user.id },
      });
    }),

  updateService: protectedProcedure
    .input(
      z.object({
        serviceId: z.string().cuid(),
        kind: z.nativeEnum(ServiceKind).optional(),
        status: z.nativeEnum(ServiceStatus).optional(),
        component: z.string().min(1).max(160).optional(),
        description: z.string().max(4000).nullish(),
        hoursAtService: z.number().min(0).max(100_000).nullish(),
        eventId: z.string().cuid().nullish(),
        performedById: z.string().cuid().nullish(),
        performedOn: z.date().nullish(),
        costMinor: moneySchema,
        nextDueOn: z.date().nullish(),
        nextDueHours: z.number().min(0).max(100_000).nullish(),
        notes: z.string().max(4000).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { serviceId, ...data } = input;
      const service = await ctx.db.carService.findUnique({
        where: { id: serviceId },
        select: { carId: true },
      });
      if (!service) throw new TRPCError({ code: "NOT_FOUND" });
      const teamId = await teamForCar(ctx.db, service.carId);
      await assertGarageWrite(ctx.db, teamId, ctx.user.id);

      return ctx.db.carService.update({ where: { id: serviceId }, data });
    }),

  /** Updates a car's running hours, which is what intervals measure against. */
  setRunningHours: protectedProcedure
    .input(
      z.object({
        carId: z.string().cuid(),
        runningHours: z.number().min(0).max(100_000).nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const teamId = await teamForCar(ctx.db, input.carId);
      await assertGarageWrite(ctx.db, teamId, ctx.user.id);
      return ctx.db.car.update({
        where: { id: input.carId },
        data: { runningHours: input.runningHours },
      });
    }),

  // -- Seat time -----------------------------------------------------------

  /**
   * Who has been in the car this season, across every event the team entered.
   *
   * The event-level view answers "is this entry legal"; this answers "who is
   * owed a run", which is the question asked between events and which nothing
   * else on the platform could answer.
   */
  seatTime: protectedProcedure
    .input(
      z.object({
        teamId: z.string().cuid(),
        /// Restricts to events starting on or after this date.
        since: z.date().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      await assertGarageRead(ctx.db, input.teamId, ctx.user.id);

      const stints = await ctx.db.stint.findMany({
        where: {
          registration: {
            teamId: input.teamId,
            ...(input.since ? { event: { date: { gte: input.since } } } : {}),
          },
        },
        select: {
          id: true,
          registrationId: true,
          lineupDriverId: true,
          startedAt: true,
          endedAt: true,
          laps: true,
          lineupDriver: { select: { userId: true } },
          registration: {
            select: {
              event: { select: { id: true, name: true, date: true } },
            },
          },
        },
      });

      const seasonStints: SeasonStint[] = stints.map((stint) => ({
        id: stint.id,
        registrationId: stint.registrationId,
        lineupDriverId: stint.lineupDriverId,
        startedAt: stint.startedAt,
        endedAt: stint.endedAt,
        laps: stint.laps,
        userId: stint.lineupDriver?.userId ?? null,
        eventId: stint.registration.event.id,
        eventName: stint.registration.event.name,
        eventDate: stint.registration.event.date,
      }));

      const summary = seatTimeByDriver(seasonStints);

      // Names for the drivers who appear, plus the current roster, so the
      // console can also show who has *not* been out.
      const roster = await ctx.db.teamMembership.findMany({
        where: { teamId: input.teamId, endDate: null },
        select: {
          role: true,
          user: {
            select: { id: true, profile: { select: { displayName: true } } },
          },
        },
      });

      return {
        ...summary,
        roster: roster.map((member) => ({
          userId: member.user.id,
          role: member.role,
          displayName: member.user.profile?.displayName ?? null,
        })),
      };
    }),
});
