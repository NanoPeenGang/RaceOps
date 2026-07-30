import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { RequirementEnforcement, RequirementKind } from "@prisma/client";
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
import { eligibilityForRegistration } from "@/server/services/eligibility";

/**
 * Entry requirements: what a driver must satisfy before an entry can run.
 *
 * Requirements are defined per series (optionally narrowed to a class) and
 * evaluated against every declared driver on an entry. Organizers can sign off
 * or waive anything the platform cannot verify itself, which is how a briefing
 * or a paper licence gets recorded.
 */

export const eligibilityRouter = createTRPCRouter({
  /** A series' entry requirements — public, since entrants must read them. */
  forSeries: publicProcedure
    .input(z.object({ seriesId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.db.entryRequirement.findMany({
        where: { seriesId: input.seriesId },
        orderBy: [{ active: "desc" }, { createdAt: "asc" }],
      });
    }),

  create: protectedProcedure
    .input(
      z.object({
        seriesId: z.string().cuid(),
        seriesClassId: z.string().cuid().nullish(),
        kind: z.nativeEnum(RequirementKind),
        label: z.string().min(2).max(160),
        description: z.string().max(2000).optional(),
        enforcement: z
          .nativeEnum(RequirementEnforcement)
          .default(RequirementEnforcement.BLOCKING),
        credentialKind: z.string().max(60).optional(),
        simPlatform: z.string().max(40).optional(),
        minRating: z.number().int().min(0).max(20000).optional(),
        minAge: z.number().int().min(0).max(120).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { seriesId, ...data } = input;
      await assertSeriesRole(ctx.db, seriesId, ctx.user.id, SERIES_ADMIN_ROLES);

      // A requirement missing the field its kind depends on can never be
      // satisfied automatically, so it is rejected rather than stored.
      if (data.kind === RequirementKind.CREDENTIAL && !data.credentialKind) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "A credential requirement needs a credential kind.",
        });
      }
      if (
        data.kind === RequirementKind.SIM_RATING &&
        (!data.simPlatform || data.minRating === undefined)
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "A rating requirement needs a platform and a minimum.",
        });
      }
      if (data.kind === RequirementKind.MIN_AGE && data.minAge === undefined) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "An age requirement needs a minimum age.",
        });
      }

      if (data.seriesClassId) {
        const target = await ctx.db.seriesClass.findUnique({
          where: { id: data.seriesClassId },
          select: { seriesId: true },
        });
        if (!target || target.seriesId !== seriesId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "That class belongs to a different series.",
          });
        }
      }

      return ctx.db.entryRequirement.create({ data: { ...data, seriesId } });
    }),

  update: protectedProcedure
    .input(
      z.object({
        requirementId: z.string().cuid(),
        label: z.string().min(2).max(160).optional(),
        description: z.string().max(2000).nullish(),
        enforcement: z.nativeEnum(RequirementEnforcement).optional(),
        active: z.boolean().optional(),
        minRating: z.number().int().min(0).max(20000).nullish(),
        minAge: z.number().int().min(0).max(120).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { requirementId, ...data } = input;
      const existing = await ctx.db.entryRequirement.findUnique({
        where: { id: requirementId },
        select: { seriesId: true },
      });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      await assertSeriesRole(
        ctx.db,
        existing.seriesId,
        ctx.user.id,
        SERIES_ADMIN_ROLES,
      );
      return ctx.db.entryRequirement.update({
        where: { id: requirementId },
        data,
      });
    }),

  remove: protectedProcedure
    .input(z.object({ requirementId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.entryRequirement.findUnique({
        where: { id: input.requirementId },
        select: { seriesId: true },
      });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      await assertSeriesRole(
        ctx.db,
        existing.seriesId,
        ctx.user.id,
        SERIES_ADMIN_ROLES,
      );
      await ctx.db.entryRequirement.delete({
        where: { id: input.requirementId },
      });
      return { deleted: true };
    }),

  // -------------------------------------------------------------------------
  // Evaluation
  // -------------------------------------------------------------------------

  /**
   * How one entry stands against the requirements. Public, because an entrant
   * needs to see what is outstanding on their own entry.
   */
  forRegistration: publicProcedure
    .input(z.object({ registrationId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      return eligibilityForRegistration(ctx.db, input.registrationId);
    }),

  /** Every entry's standing for an event — the scrutineering-desk view. */
  forEvent: protectedProcedure
    .input(z.object({ eventId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      await assertEventOrganizer(
        ctx.db,
        input.eventId,
        ctx.user.id,
        SERIES_EVENT_ROLES,
      );
      const registrations = await ctx.db.eventRegistration.findMany({
        where: { eventId: input.eventId, status: { not: "WITHDRAWN" } },
        select: {
          id: true,
          carNumber: true,
          team: { select: { name: true } },
          entrantUser: {
            select: { profile: { select: { displayName: true } } },
          },
        },
        orderBy: { carNumber: "asc" },
      });

      const rows = [];
      for (const registration of registrations) {
        const state = await eligibilityForRegistration(ctx.db, registration.id);
        rows.push({
          registrationId: registration.id,
          carNumber: registration.carNumber,
          label:
            registration.team?.name ??
            registration.entrantUser?.profile?.displayName ??
            "Entry",
          ...state,
        });
      }
      return rows;
    }),

  /** Sign off or waive one requirement for one driver on one entry. */
  decide: protectedProcedure
    .input(
      z.object({
        requirementId: z.string().cuid(),
        registrationId: z.string().cuid(),
        userId: z.string().cuid(),
        granted: z.boolean(),
        reason: z.string().max(2000).optional(),
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

      return ctx.db.requirementWaiver.upsert({
        where: {
          requirementId_registrationId_userId: {
            requirementId: input.requirementId,
            registrationId: input.registrationId,
            userId: input.userId,
          },
        },
        create: {
          requirementId: input.requirementId,
          registrationId: input.registrationId,
          userId: input.userId,
          granted: input.granted,
          reason: input.reason,
          decidedById: ctx.user.id,
        },
        update: {
          granted: input.granted,
          reason: input.reason,
          decidedById: ctx.user.id,
        },
      });
    }),

  /** Withdraws a decision, returning the requirement to its automatic state. */
  clearDecision: protectedProcedure
    .input(
      z.object({
        requirementId: z.string().cuid(),
        registrationId: z.string().cuid(),
        userId: z.string().cuid(),
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
      await ctx.db.requirementWaiver.deleteMany({
        where: {
          requirementId: input.requirementId,
          registrationId: input.registrationId,
          userId: input.userId,
        },
      });
      return { cleared: true };
    }),
});
