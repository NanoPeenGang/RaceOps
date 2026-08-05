import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { PitStopKind, PitStopStatus } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { createTRPCRouter, protectedProcedure } from "@/server/trpc/trpc";
import { checkPlan, nextSequence, nextStop, stopTiming } from "@/lib/pit-stops";
import {
  getSeriesRole,
  SERIES_EVENT_ROLES,
} from "@/server/services/series-auth";

/**
 * Pit stop planning during an event.
 *
 * The plan belongs to the entry, not the car: the same car in two events has
 * two independent stop sequences, and a plan that followed the car would carry
 * last month's fuel numbers into this weekend.
 *
 * Written by the team running the entry. Read, additionally, by the series'
 * event organizers — race control watching a plan is how a driver-change
 * regulation gets checked before it is breached rather than after.
 */

interface PitAccess {
  canWrite: boolean;
  eventId: string;
}

async function assertPitAccess(
  db: PrismaClient,
  registrationId: string,
  userId: string,
): Promise<PitAccess> {
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

  if (
    registration.submittedById === userId ||
    registration.entrantUserId === userId
  ) {
    return { canWrite: true, eventId: registration.eventId };
  }

  if (registration.teamId) {
    const membership = await db.teamMembership.findUnique({
      where: { teamId_userId: { teamId: registration.teamId, userId } },
      select: { role: true, endDate: true },
    });
    if (membership && membership.endDate === null) {
      /*
       * The whole active roster can write the plan, not just managers. A stop
       * plan is edited in a pit box by whoever has a free hand, and a rule
       * that only the manager may move a stop means the plan stops being
       * updated the moment it matters most.
       */
      return { canWrite: true, eventId: registration.eventId };
    }
  }

  // Organizers read, and do not write. A team's stop plan is theirs; an
  // official editing it would be changing a decision they do not own.
  const role = registration.event.seriesId
    ? await getSeriesRole(db, registration.event.seriesId, userId)
    : null;
  if (role && SERIES_EVENT_ROLES.roles.includes(role)) {
    return { canWrite: false, eventId: registration.eventId };
  }

  throw new TRPCError({
    code: "FORBIDDEN",
    message: "Pit stop plans are for the team running the entry.",
  });
}

async function assertCanWrite(
  db: PrismaClient,
  registrationId: string,
  userId: string,
): Promise<void> {
  const access = await assertPitAccess(db, registrationId, userId);
  if (!access.canWrite) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Officials can see the plan but not change it.",
    });
  }
}

/** Loads a stop and checks the caller may write it, in one place. */
async function stopForWrite(
  db: PrismaClient,
  stopId: string,
  userId: string,
): Promise<{ registrationId: string }> {
  const stop = await db.pitStopPlan.findUnique({
    where: { id: stopId },
    select: { registrationId: true },
  });
  if (!stop) throw new TRPCError({ code: "NOT_FOUND" });
  await assertCanWrite(db, stop.registrationId, userId);
  return stop;
}

const driverSchema = z.string().cuid().nullish();

export const pitStopRouter = createTRPCRouter({
  /** The plan for one entry, with its problems and how the stops are going. */
  forEntry: protectedProcedure
    .input(z.object({ registrationId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      const access = await assertPitAccess(
        ctx.db,
        input.registrationId,
        ctx.user.id,
      );

      const stops = await ctx.db.pitStopPlan.findMany({
        where: { registrationId: input.registrationId },
        orderBy: { sequence: "asc" },
        include: {
          session: { select: { id: true, name: true, type: true } },
          tireSet: { select: { id: true, identifier: true, compound: true } },
          driverIn: {
            select: {
              id: true,
              user: {
                select: { id: true, profile: { select: { displayName: true } } },
              },
            },
          },
          driverOut: {
            select: {
              id: true,
              user: {
                select: { id: true, profile: { select: { displayName: true } } },
              },
            },
          },
        },
      });

      return {
        stops,
        canWrite: access.canWrite,
        problems: checkPlan(stops),
        next: nextStop(stops),
        timing: stopTiming(stops),
      };
    }),

  add: protectedProcedure
    .input(
      z.object({
        registrationId: z.string().cuid(),
        sessionId: z.string().cuid().nullish(),
        kind: z.nativeEnum(PitStopKind).default(PitStopKind.FUEL),
        targetLap: z.number().int().min(1).max(10_000).nullish(),
        targetAt: z.date().nullish(),
        driverInId: driverSchema,
        driverOutId: driverSchema,
        fuelLitres: z.number().min(0).max(1000).nullish(),
        tireSetId: z.string().cuid().nullish(),
        plannedSeconds: z.number().int().min(0).max(36_000).nullish(),
        notes: z.string().max(2000).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertCanWrite(ctx.db, input.registrationId, ctx.user.id);

      const existing = await ctx.db.pitStopPlan.findMany({
        where: { registrationId: input.registrationId },
        select: { sequence: true },
      });

      return ctx.db.pitStopPlan.create({
        data: {
          ...input,
          // Server-assigned so two people adding a stop at once cannot both
          // claim number 4 — the unique index would reject the second, and a
          // client-supplied number would make that a routine collision rather
          // than a race.
          sequence: nextSequence(existing),
          createdById: ctx.user.id,
        },
      });
    }),

  update: protectedProcedure
    .input(
      z.object({
        stopId: z.string().cuid(),
        sessionId: z.string().cuid().nullish(),
        kind: z.nativeEnum(PitStopKind).optional(),
        status: z.nativeEnum(PitStopStatus).optional(),
        targetLap: z.number().int().min(1).max(10_000).nullish(),
        targetAt: z.date().nullish(),
        driverInId: driverSchema,
        driverOutId: driverSchema,
        fuelLitres: z.number().min(0).max(1000).nullish(),
        tireSetId: z.string().cuid().nullish(),
        plannedSeconds: z.number().int().min(0).max(36_000).nullish(),
        actualAt: z.date().nullish(),
        actualSeconds: z.number().int().min(0).max(36_000).nullish(),
        notes: z.string().max(2000).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { stopId, ...data } = input;
      await stopForWrite(ctx.db, stopId, ctx.user.id);
      return ctx.db.pitStopPlan.update({ where: { id: stopId }, data });
    }),

  /**
   * Marks a stop done, stamping the time if the caller did not supply one.
   *
   * A separate mutation rather than an `update` with three fields, because it
   * is pressed on a phone in a pit lane with one thumb: the whole point is
   * that it takes one tap and records the moment it was tapped.
   */
  complete: protectedProcedure
    .input(
      z.object({
        stopId: z.string().cuid(),
        actualSeconds: z.number().int().min(0).max(36_000).nullish(),
        actualAt: z.date().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await stopForWrite(ctx.db, input.stopId, ctx.user.id);
      return ctx.db.pitStopPlan.update({
        where: { id: input.stopId },
        data: {
          status: PitStopStatus.COMPLETED,
          actualAt: input.actualAt ?? new Date(),
          ...(input.actualSeconds == null
            ? {}
            : { actualSeconds: input.actualSeconds }),
        },
      });
    }),

  /**
   * Renumbers the plan.
   *
   * Sequence is unique per entry, so the rows are moved out of the way first
   * and then written back. Without the two-phase write, swapping stops 2 and 3
   * hits the unique index halfway through and leaves the plan half-reordered —
   * which is worse than refusing.
   */
  reorder: protectedProcedure
    .input(
      z.object({
        registrationId: z.string().cuid(),
        stopIds: z.array(z.string().cuid()).min(1).max(100),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertCanWrite(ctx.db, input.registrationId, ctx.user.id);

      const stops = await ctx.db.pitStopPlan.findMany({
        where: { registrationId: input.registrationId },
        select: { id: true, sequence: true },
      });
      const known = new Set(stops.map((stop) => stop.id));
      if (
        input.stopIds.length !== stops.length ||
        input.stopIds.some((id) => !known.has(id))
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "That ordering does not match the stops on this entry.",
        });
      }

      /*
       * Park above the highest number in use, not below zero: `sequence >= 1`
       * is a CHECK, and a CHECK is evaluated on every row as it is written,
       * not only at commit. Parking high satisfies both the CHECK and the
       * unique index for the length of the transaction.
       */
      const parkFrom =
        stops.reduce((max, stop) => Math.max(max, stop.sequence), 0) + 1;

      await ctx.db.$transaction(async (tx) => {
        for (const [index, id] of input.stopIds.entries()) {
          await tx.pitStopPlan.update({
            where: { id },
            data: { sequence: parkFrom + index },
          });
        }
        for (const [index, id] of input.stopIds.entries()) {
          await tx.pitStopPlan.update({
            where: { id },
            data: { sequence: index + 1 },
          });
        }
      });
      return { reordered: input.stopIds.length };
    }),

  remove: protectedProcedure
    .input(z.object({ stopId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const stop = await ctx.db.pitStopPlan.findUnique({
        where: { id: input.stopId },
        select: { registrationId: true, status: true },
      });
      if (!stop) throw new TRPCError({ code: "NOT_FOUND" });
      await assertCanWrite(ctx.db, stop.registrationId, ctx.user.id);

      if (stop.status === PitStopStatus.COMPLETED) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "That stop already happened. Deleting it would break the fuel and stint numbers that depend on it.",
        });
      }

      await ctx.db.pitStopPlan.delete({ where: { id: input.stopId } });
      return { deleted: true };
    }),
});
