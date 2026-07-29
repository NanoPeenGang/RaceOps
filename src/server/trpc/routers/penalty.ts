import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  AppealStatus,
  NotificationType,
  PenaltyStatus,
  PenaltyType,
  TeamRole,
} from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import {
  createTRPCRouter,
  protectedProcedure,
  publicProcedure,
} from "@/server/trpc/trpc";
import {
  assertEventOrganizer,
  eventOrganizerIds,
  SERIES_APPEAL_ROLES,
  SERIES_PENALTY_ROLES,
} from "@/server/services/series-auth";
import { notify } from "@/server/services/notifications";
import {
  canAppeal,
  isAppealOpen,
  penaltyStatusAfterAppeal,
  validatePenaltyMagnitude,
} from "@/lib/penalties";

const ENTRY_MANAGER_ROLES: TeamRole[] = [TeamRole.OWNER, TeamRole.MANAGER];

/** Public shape of a penalty — penalties are a matter of public record. */
const publicPenaltyInclude = {
  registration: {
    select: {
      id: true,
      carNumber: true,
      carClass: true,
      team: { select: { id: true, name: true, slug: true } },
      entrantUser: {
        select: { id: true, profile: { select: { displayName: true } } },
      },
    },
  },
  event: { select: { id: true, name: true, date: true, seriesId: true } },
  issuedBy: { select: { id: true, profile: { select: { displayName: true } } } },
  appeal: {
    select: {
      id: true,
      status: true,
      statement: true,
      decision: true,
      decidedAt: true,
      createdAt: true,
    },
  },
  media: {
    where: { visibility: "PUBLIC" as const },
    select: { id: true, url: true, kind: true, title: true },
  },
} as const;

/**
 * Whoever may act for the entry a penalty was issued against: the individual
 * entrant, or an active owner/manager of the entered team.
 */
async function assertCanActForRegistration(
  db: PrismaClient,
  registrationId: string,
  userId: string,
) {
  const registration = await db.eventRegistration.findUnique({
    where: { id: registrationId },
    select: { teamId: true, entrantUserId: true, submittedById: true },
  });
  if (!registration) throw new TRPCError({ code: "NOT_FOUND" });

  if (
    registration.entrantUserId === userId ||
    registration.submittedById === userId
  ) {
    return;
  }
  if (registration.teamId) {
    const membership = await db.teamMembership.findUnique({
      where: { teamId_userId: { teamId: registration.teamId, userId } },
    });
    if (
      membership &&
      membership.endDate === null &&
      ENTRY_MANAGER_ROLES.includes(membership.role)
    ) {
      return;
    }
  }
  throw new TRPCError({
    code: "FORBIDDEN",
    message: "Only the competitor named in the entry can do that.",
  });
}

/** Everyone who should hear about a penalty decision on this entry. */
async function registrationContacts(
  db: PrismaClient,
  registrationId: string,
): Promise<string[]> {
  const registration = await db.eventRegistration.findUnique({
    where: { id: registrationId },
    select: { teamId: true, entrantUserId: true, submittedById: true },
  });
  if (!registration) return [];
  const ids = new Set<string>([registration.submittedById]);
  if (registration.entrantUserId) ids.add(registration.entrantUserId);
  if (registration.teamId) {
    const managers = await db.teamMembership.findMany({
      where: {
        teamId: registration.teamId,
        role: { in: ENTRY_MANAGER_ROLES },
        endDate: null,
      },
      select: { userId: true },
    });
    for (const manager of managers) ids.add(manager.userId);
  }
  return [...ids];
}

export const penaltyRouter = createTRPCRouter({
  // -------------------------------------------------------------------------
  // Public record
  // -------------------------------------------------------------------------

  /** All penalties for an event — public. */
  forEvent: publicProcedure
    .input(z.object({ eventId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.db.penalty.findMany({
        where: { eventId: input.eventId },
        orderBy: { createdAt: "desc" },
        include: publicPenaltyInclude,
      });
    }),

  /** A competitor's penalty record across a series — public by design. */
  forCompetitorInSeries: publicProcedure
    .input(
      z.object({
        seriesId: z.string().cuid(),
        teamId: z.string().cuid().optional(),
        userId: z.string().cuid().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      if (!input.teamId && !input.userId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Provide a team or a user.",
        });
      }
      return ctx.db.penalty.findMany({
        where: {
          event: { seriesId: input.seriesId },
          registration: input.teamId
            ? { teamId: input.teamId }
            : { entrantUserId: input.userId },
        },
        orderBy: { createdAt: "desc" },
        include: publicPenaltyInclude,
      });
    }),

  // -------------------------------------------------------------------------
  // Race control
  // -------------------------------------------------------------------------

  issue: protectedProcedure
    .input(
      z.object({
        registrationId: z.string().cuid(),
        type: z.nativeEnum(PenaltyType),
        summary: z.string().min(3).max(200),
        details: z.string().max(4000).optional(),
        regulation: z.string().max(120).optional(),
        lapNumber: z.number().int().min(0).max(10000).optional(),
        timeSeconds: z.number().int().min(1).max(86400).optional(),
        gridPlaces: z.number().int().min(1).max(60).optional(),
        pointsDeducted: z.number().int().min(1).max(1000).optional(),
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
        SERIES_PENALTY_ROLES,
      );

      const valid = validatePenaltyMagnitude(input.type, input);
      if (!valid.ok) {
        throw new TRPCError({ code: "BAD_REQUEST", message: valid.message });
      }

      const penalty = await ctx.db.penalty.create({
        data: {
          ...input,
          eventId: registration.eventId,
          issuedById: ctx.user.id,
        },
        include: { event: { select: { name: true } } },
      });

      const contacts = await registrationContacts(ctx.db, input.registrationId);
      await Promise.all(
        contacts.map((userId) =>
          notify(ctx.db, {
            userId,
            type: NotificationType.SYSTEM,
            title: `Penalty issued — ${penalty.event.name}`,
            body: input.summary,
            linkUrl: `/events/${registration.eventId}/penalties`,
          }),
        ),
      );
      return penalty;
    }),

  /** Amend a penalty before it is challenged (typos, wrong magnitude). */
  update: protectedProcedure
    .input(
      z.object({
        penaltyId: z.string().cuid(),
        summary: z.string().min(3).max(200).optional(),
        details: z.string().max(4000).nullish(),
        regulation: z.string().max(120).nullish(),
        timeSeconds: z.number().int().min(1).max(86400).nullish(),
        gridPlaces: z.number().int().min(1).max(60).nullish(),
        pointsDeducted: z.number().int().min(1).max(1000).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const penalty = await ctx.db.penalty.findUnique({
        where: { id: input.penaltyId },
      });
      if (!penalty) throw new TRPCError({ code: "NOT_FOUND" });
      await assertEventOrganizer(
        ctx.db,
        penalty.eventId,
        ctx.user.id,
        SERIES_PENALTY_ROLES,
      );
      if (penalty.status === PenaltyStatus.UNDER_APPEAL) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "This penalty is under appeal — rule on the appeal instead of amending it.",
        });
      }
      const { penaltyId, ...data } = input;
      return ctx.db.penalty.update({ where: { id: penaltyId }, data });
    }),

  rescind: protectedProcedure
    .input(z.object({ penaltyId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const penalty = await ctx.db.penalty.findUnique({
        where: { id: input.penaltyId },
        include: { event: { select: { name: true } } },
      });
      if (!penalty) throw new TRPCError({ code: "NOT_FOUND" });
      await assertEventOrganizer(
        ctx.db,
        penalty.eventId,
        ctx.user.id,
        SERIES_PENALTY_ROLES,
      );
      const updated = await ctx.db.penalty.update({
        where: { id: penalty.id },
        data: { status: PenaltyStatus.OVERTURNED },
      });
      const contacts = await registrationContacts(
        ctx.db,
        penalty.registrationId,
      );
      await Promise.all(
        contacts.map((userId) =>
          notify(ctx.db, {
            userId,
            type: NotificationType.SYSTEM,
            title: `Penalty rescinded — ${penalty.event.name}`,
            linkUrl: `/events/${penalty.eventId}/penalties`,
          }),
        ),
      );
      return updated;
    }),

  // -------------------------------------------------------------------------
  // Appeals
  // -------------------------------------------------------------------------

  fileAppeal: protectedProcedure
    .input(
      z.object({
        penaltyId: z.string().cuid(),
        statement: z.string().min(20).max(8000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const penalty = await ctx.db.penalty.findUnique({
        where: { id: input.penaltyId },
        include: { appeal: true, event: { select: { name: true, seriesId: true } } },
      });
      if (!penalty) throw new TRPCError({ code: "NOT_FOUND" });
      await assertCanActForRegistration(
        ctx.db,
        penalty.registrationId,
        ctx.user.id,
      );
      if (penalty.appeal) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "This penalty has already been appealed.",
        });
      }
      if (!canAppeal(penalty.status)) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `A penalty that is ${penalty.status.toLowerCase().replace("_", " ")} can no longer be appealed.`,
        });
      }

      const [appeal] = await ctx.db.$transaction([
        ctx.db.penaltyAppeal.create({
          data: {
            penaltyId: penalty.id,
            filedById: ctx.user.id,
            statement: input.statement,
          },
        }),
        ctx.db.penalty.update({
          where: { id: penalty.id },
          data: { status: PenaltyStatus.UNDER_APPEAL },
        }),
      ]);

      if (penalty.event.seriesId) {
        const stewards = await eventOrganizerIds(
          ctx.db,
          penalty.event.seriesId,
          SERIES_APPEAL_ROLES,
        );
        await Promise.all(
          stewards.map((userId) =>
            notify(ctx.db, {
              userId,
              type: NotificationType.SYSTEM,
              title: `Appeal filed — ${penalty.event.name}`,
              body: penalty.summary,
              linkUrl: `/events/${penalty.eventId}/manage`,
            }),
          ),
        );
      }
      return appeal;
    }),

  /** Stewards rule on an appeal; the penalty follows the outcome. */
  decideAppeal: protectedProcedure
    .input(
      z.object({
        appealId: z.string().cuid(),
        outcome: z.enum([AppealStatus.UPHELD, AppealStatus.REJECTED]),
        decision: z.string().min(10).max(4000),
        /** When upholding, keep a lesser sanction instead of overturning. */
        reducedPointsDeducted: z.number().int().min(0).max(1000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const appeal = await ctx.db.penaltyAppeal.findUnique({
        where: { id: input.appealId },
        include: {
          penalty: { include: { event: { select: { name: true } } } },
        },
      });
      if (!appeal) throw new TRPCError({ code: "NOT_FOUND" });
      await assertEventOrganizer(
        ctx.db,
        appeal.penalty.eventId,
        ctx.user.id,
        SERIES_APPEAL_ROLES,
      );
      if (!isAppealOpen(appeal.status)) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "This appeal has already been decided.",
        });
      }

      const outcome = input.outcome as
        | typeof AppealStatus.UPHELD
        | typeof AppealStatus.REJECTED;
      const reduced =
        outcome === AppealStatus.UPHELD &&
        input.reducedPointsDeducted !== undefined &&
        input.reducedPointsDeducted > 0;
      const penaltyStatus = penaltyStatusAfterAppeal(outcome, reduced);

      const [, updatedPenalty] = await ctx.db.$transaction([
        ctx.db.penaltyAppeal.update({
          where: { id: appeal.id },
          data: {
            status: outcome,
            decision: input.decision,
            decidedById: ctx.user.id,
            decidedAt: new Date(),
          },
        }),
        ctx.db.penalty.update({
          where: { id: appeal.penaltyId },
          data: {
            status: penaltyStatus,
            ...(reduced
              ? { pointsDeducted: input.reducedPointsDeducted }
              : {}),
          },
        }),
      ]);

      const contacts = await registrationContacts(
        ctx.db,
        appeal.penalty.registrationId,
      );
      await Promise.all(
        contacts.map((userId) =>
          notify(ctx.db, {
            userId,
            type: NotificationType.SYSTEM,
            title: `Appeal decided — ${appeal.penalty.event.name}`,
            body: input.decision.slice(0, 200),
            linkUrl: `/events/${appeal.penalty.eventId}/penalties`,
          }),
        ),
      );
      return updatedPenalty;
    }),

  /** Penalties issued against the caller's entries, with appeal state. */
  mine: protectedProcedure.query(async ({ ctx }) => {
    const teamIds = (
      await ctx.db.teamMembership.findMany({
        where: {
          userId: ctx.user.id,
          role: { in: ENTRY_MANAGER_ROLES },
          endDate: null,
        },
        select: { teamId: true },
      })
    ).map((m) => m.teamId);

    return ctx.db.penalty.findMany({
      where: {
        registration: {
          OR: [
            { entrantUserId: ctx.user.id },
            { submittedById: ctx.user.id },
            ...(teamIds.length ? [{ teamId: { in: teamIds } }] : []),
          ],
        },
      },
      orderBy: { createdAt: "desc" },
      include: publicPenaltyInclude,
    });
  }),
});
