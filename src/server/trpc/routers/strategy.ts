import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { Prisma } from "@prisma/client";
import { createTRPCRouter, protectedProcedure } from "@/server/trpc/trpc";

/**
 * Pit Wall strategy plans (Phase 3): saved against an event, private to the
 * author unless shared with a team the author actively belongs to.
 */

const planPayload = z.object({
  stintPlan: z.record(z.string(), z.unknown()).optional(),
  fuelStrategy: z.record(z.string(), z.unknown()).optional(),
  driverRotation: z.record(z.string(), z.unknown()).optional(),
});

/** Team ids the user is an active member of — the read-sharing scope. */
async function activeTeamIds(
  db: Parameters<typeof assertActiveMember>[0],
  userId: string,
): Promise<string[]> {
  const memberships = await db.teamMembership.findMany({
    where: { userId, endDate: null },
    select: { teamId: true },
  });
  return memberships.map((m) => m.teamId);
}

async function assertActiveMember(
  db: Prisma.TransactionClient | typeof import("@/server/db/client").db,
  teamId: string,
  userId: string,
): Promise<void> {
  const membership = await db.teamMembership.findUnique({
    where: { teamId_userId: { teamId, userId } },
  });
  if (!membership || membership.endDate !== null) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You can only share a plan with a team you belong to.",
    });
  }
}

export const strategyRouter = createTRPCRouter({
  /** Plans the caller can read for an event: their own plus team-shared. */
  listForEvent: protectedProcedure
    .input(z.object({ eventId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      const teamIds = await activeTeamIds(ctx.db, ctx.user.id);
      return ctx.db.strategyPlan.findMany({
        where: {
          eventId: input.eventId,
          OR: [
            { ownerId: ctx.user.id },
            ...(teamIds.length ? [{ teamId: { in: teamIds } }] : []),
          ],
        },
        orderBy: { updatedAt: "desc" },
        include: {
          team: { select: { id: true, name: true } },
          owner: { select: { id: true, profile: { select: { displayName: true } } } },
        },
      });
    }),

  mine: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db.strategyPlan.findMany({
      where: { ownerId: ctx.user.id },
      orderBy: { updatedAt: "desc" },
      include: {
        event: { select: { id: true, name: true, date: true } },
        team: { select: { name: true } },
      },
    });
  }),

  create: protectedProcedure
    .input(
      planPayload.extend({
        eventId: z.string().cuid(),
        name: z.string().min(1).max(120),
        teamId: z.string().cuid().nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { eventId, name, teamId, ...payload } = input;
      if (teamId) await assertActiveMember(ctx.db, teamId, ctx.user.id);
      const event = await ctx.db.raceEvent.findUnique({
        where: { id: eventId },
        select: { id: true },
      });
      if (!event) throw new TRPCError({ code: "NOT_FOUND" });

      return ctx.db.strategyPlan.create({
        data: {
          eventId,
          name,
          teamId: teamId ?? null,
          ownerId: ctx.user.id,
          stintPlan: payload.stintPlan as Prisma.InputJsonValue | undefined,
          fuelStrategy: payload.fuelStrategy as Prisma.InputJsonValue | undefined,
          driverRotation: payload.driverRotation as
            | Prisma.InputJsonValue
            | undefined,
        },
      });
    }),

  update: protectedProcedure
    .input(
      planPayload.extend({
        planId: z.string().cuid(),
        name: z.string().min(1).max(120).optional(),
        teamId: z.string().cuid().nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const plan = await ctx.db.strategyPlan.findUnique({
        where: { id: input.planId },
      });
      // Only the author may edit, even when shared with a team.
      if (!plan || plan.ownerId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      if (input.teamId) {
        await assertActiveMember(ctx.db, input.teamId, ctx.user.id);
      }
      const { planId, ...data } = input;
      return ctx.db.strategyPlan.update({
        where: { id: planId },
        data: {
          ...(data.name !== undefined ? { name: data.name } : {}),
          ...(data.teamId !== undefined ? { teamId: data.teamId } : {}),
          ...(data.stintPlan !== undefined
            ? { stintPlan: data.stintPlan as Prisma.InputJsonValue }
            : {}),
          ...(data.fuelStrategy !== undefined
            ? { fuelStrategy: data.fuelStrategy as Prisma.InputJsonValue }
            : {}),
          ...(data.driverRotation !== undefined
            ? { driverRotation: data.driverRotation as Prisma.InputJsonValue }
            : {}),
        },
      });
    }),

  delete: protectedProcedure
    .input(z.object({ planId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.db.strategyPlan.deleteMany({
        where: { id: input.planId, ownerId: ctx.user.id },
      });
      if (result.count === 0) throw new TRPCError({ code: "NOT_FOUND" });
      return { deleted: true };
    }),
});
