import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  CheckResult,
  InspectionStage,
  InspectionStatus,
  NotificationType,
  PenaltyType,
} from "@prisma/client";
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
import {
  deriveInspectionStatus,
  failedChecks,
  resultFromMeasurement,
} from "@/lib/scrutineering";
import { notify } from "@/server/services/notifications";

/**
 * Technical inspection.
 *
 * A template is the card a club writes once; an inspection is one car's trip
 * through the bay. Checks are copied onto the inspection when it opens, so
 * editing a template later never rewrites history — a card records what was
 * actually checked on the day.
 */

/** Recomputes an inspection's status from its checks and stores it. */
async function refreshStatus(
  db: PrismaClient,
  inspectionId: string,
): Promise<InspectionStatus> {
  const inspection = await db.inspection.findUnique({
    where: { id: inspectionId },
    select: { status: true, checks: true },
  });
  if (!inspection) throw new TRPCError({ code: "NOT_FOUND" });

  const next = deriveInspectionStatus(inspection.checks, inspection.status);
  if (next !== inspection.status) {
    await db.inspection.update({
      where: { id: inspectionId },
      data: {
        status: next,
        completedAt:
          next === InspectionStatus.PASSED || next === InspectionStatus.FAILED
            ? new Date()
            : null,
      },
    });
  }
  return next;
}

/** The event an inspection belongs to, for authorization. */
async function eventIdForInspection(
  db: PrismaClient,
  inspectionId: string,
): Promise<{ eventId: string; registrationId: string }> {
  const inspection = await db.inspection.findUnique({
    where: { id: inspectionId },
    select: {
      registrationId: true,
      registration: { select: { eventId: true } },
    },
  });
  if (!inspection) throw new TRPCError({ code: "NOT_FOUND" });
  return {
    eventId: inspection.registration.eventId,
    registrationId: inspection.registrationId,
  };
}

export const scrutineeringRouter = createTRPCRouter({
  // -------------------------------------------------------------------------
  // Templates
  // -------------------------------------------------------------------------

  /** A series' inspection cards — public, so entrants can prepare. */
  templates: publicProcedure
    .input(z.object({ seriesId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.db.inspectionTemplate.findMany({
        where: { seriesId: input.seriesId },
        orderBy: [{ active: "desc" }, { name: "asc" }],
        include: { items: { orderBy: { sortOrder: "asc" } } },
      });
    }),

  createTemplate: protectedProcedure
    .input(
      z.object({
        seriesId: z.string().cuid(),
        seriesClassId: z.string().cuid().nullish(),
        name: z.string().min(2).max(160),
        stage: z.nativeEnum(InspectionStage).default(InspectionStage.PRE_EVENT),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { seriesId, ...data } = input;
      await assertSeriesRole(ctx.db, seriesId, ctx.user.id, SERIES_ADMIN_ROLES);
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
      return ctx.db.inspectionTemplate.create({ data: { ...data, seriesId } });
    }),

  addTemplateItem: protectedProcedure
    .input(
      z.object({
        templateId: z.string().cuid(),
        label: z.string().min(1).max(200),
        regulation: z.string().max(120).optional(),
        measureUnit: z.string().max(20).optional(),
        minValue: z.number().optional(),
        maxValue: z.number().optional(),
        sortOrder: z.number().int().min(0).max(9999).default(0),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { templateId, ...data } = input;
      const template = await ctx.db.inspectionTemplate.findUnique({
        where: { id: templateId },
        select: { seriesId: true },
      });
      if (!template) throw new TRPCError({ code: "NOT_FOUND" });
      await assertSeriesRole(
        ctx.db,
        template.seriesId,
        ctx.user.id,
        SERIES_ADMIN_ROLES,
      );

      if (
        data.minValue !== undefined &&
        data.maxValue !== undefined &&
        data.minValue > data.maxValue
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "The minimum cannot exceed the maximum.",
        });
      }
      return ctx.db.inspectionTemplateItem.create({
        data: { ...data, templateId },
      });
    }),

  removeTemplateItem: protectedProcedure
    .input(z.object({ itemId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const item = await ctx.db.inspectionTemplateItem.findUnique({
        where: { id: input.itemId },
        select: { template: { select: { seriesId: true } } },
      });
      if (!item) throw new TRPCError({ code: "NOT_FOUND" });
      await assertSeriesRole(
        ctx.db,
        item.template.seriesId,
        ctx.user.id,
        SERIES_ADMIN_ROLES,
      );
      await ctx.db.inspectionTemplateItem.delete({
        where: { id: input.itemId },
      });
      return { deleted: true };
    }),

  removeTemplate: protectedProcedure
    .input(z.object({ templateId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const template = await ctx.db.inspectionTemplate.findUnique({
        where: { id: input.templateId },
        select: { seriesId: true },
      });
      if (!template) throw new TRPCError({ code: "NOT_FOUND" });
      await assertSeriesRole(
        ctx.db,
        template.seriesId,
        ctx.user.id,
        SERIES_ADMIN_ROLES,
      );
      // Past inspections keep their copied checks (templateId is SetNull).
      await ctx.db.inspectionTemplate.delete({
        where: { id: input.templateId },
      });
      return { deleted: true };
    }),

  // -------------------------------------------------------------------------
  // Inspections
  // -------------------------------------------------------------------------

  /** Inspections for one entry — public; a technical record belongs on it. */
  forRegistration: publicProcedure
    .input(z.object({ registrationId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.db.inspection.findMany({
        where: { registrationId: input.registrationId },
        orderBy: { createdAt: "desc" },
        include: {
          checks: { orderBy: { sortOrder: "asc" } },
          inspectedBy: {
            select: { id: true, profile: { select: { displayName: true } } },
          },
        },
      });
    }),

  /** Every entry's technical standing for an event — the bay's worklist. */
  forEvent: protectedProcedure
    .input(z.object({ eventId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      await assertEventOrganizer(
        ctx.db,
        input.eventId,
        ctx.user.id,
        SERIES_EVENT_ROLES,
      );
      return ctx.db.eventRegistration.findMany({
        where: { eventId: input.eventId, status: { not: "WITHDRAWN" } },
        orderBy: { carNumber: "asc" },
        select: {
          id: true,
          carNumber: true,
          carClass: true,
          team: { select: { name: true } },
          entrantUser: {
            select: { profile: { select: { displayName: true } } },
          },
          inspections: {
            orderBy: { createdAt: "desc" },
            include: { checks: { orderBy: { sortOrder: "asc" } } },
          },
        },
      });
    }),

  /**
   * Opens a card for one car, copying the template's items onto it so a later
   * template edit never rewrites what was checked on the day.
   */
  open: protectedProcedure
    .input(
      z.object({
        registrationId: z.string().cuid(),
        templateId: z.string().cuid().optional(),
        stage: z.nativeEnum(InspectionStage).default(InspectionStage.PRE_EVENT),
        /** Set when this is a re-check after a failure. */
        supersedesId: z.string().cuid().optional(),
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

      const template = input.templateId
        ? await ctx.db.inspectionTemplate.findUnique({
            where: { id: input.templateId },
            include: { items: { orderBy: { sortOrder: "asc" } } },
          })
        : null;
      if (input.templateId && !template) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      return ctx.db.inspection.create({
        data: {
          registrationId: input.registrationId,
          templateId: template?.id,
          stage: template?.stage ?? input.stage,
          supersedesId: input.supersedesId,
          inspectedById: ctx.user.id,
          checks: template
            ? {
                create: template.items.map((item) => ({
                  templateItemId: item.id,
                  label: item.label,
                  regulation: item.regulation,
                  measureUnit: item.measureUnit,
                  minValue: item.minValue,
                  maxValue: item.maxValue,
                  sortOrder: item.sortOrder,
                })),
              }
            : undefined,
        },
        include: { checks: { orderBy: { sortOrder: "asc" } } },
      });
    }),

  /** Adds an ad-hoc check to an open card. */
  addCheck: protectedProcedure
    .input(
      z.object({
        inspectionId: z.string().cuid(),
        label: z.string().min(1).max(200),
        regulation: z.string().max(120).optional(),
        measureUnit: z.string().max(20).optional(),
        minValue: z.number().optional(),
        maxValue: z.number().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { inspectionId, ...data } = input;
      const { eventId } = await eventIdForInspection(ctx.db, inspectionId);
      await assertEventOrganizer(
        ctx.db,
        eventId,
        ctx.user.id,
        SERIES_EVENT_ROLES,
      );
      const count = await ctx.db.inspectionCheck.count({
        where: { inspectionId },
      });
      const created = await ctx.db.inspectionCheck.create({
        data: { ...data, inspectionId, sortOrder: count },
      });
      await refreshStatus(ctx.db, inspectionId);
      return created;
    }),

  /**
   * Records one check. A measurement inside or outside its tolerance decides
   * the result on its own — the number is the verdict, not an opinion — unless
   * the scrutineer states one explicitly.
   */
  recordCheck: protectedProcedure
    .input(
      z.object({
        checkId: z.string().cuid(),
        result: z.nativeEnum(CheckResult).optional(),
        measuredValue: z.number().nullish(),
        notes: z.string().max(2000).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.inspectionCheck.findUnique({
        where: { id: input.checkId },
      });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      const { eventId } = await eventIdForInspection(
        ctx.db,
        existing.inspectionId,
      );
      await assertEventOrganizer(
        ctx.db,
        eventId,
        ctx.user.id,
        SERIES_EVENT_ROLES,
      );

      const measuredValue =
        input.measuredValue === undefined
          ? existing.measuredValue
          : input.measuredValue;
      const derived = resultFromMeasurement({ ...existing, measuredValue });
      const result = input.result ?? derived ?? existing.result;

      const updated = await ctx.db.inspectionCheck.update({
        where: { id: input.checkId },
        data: {
          result,
          measuredValue,
          ...(input.notes === undefined ? {} : { notes: input.notes }),
        },
      });
      await refreshStatus(ctx.db, existing.inspectionId);
      return updated;
    }),

  /** Refers a card to the stewards. Sticks until a human changes it. */
  refer: protectedProcedure
    .input(
      z.object({
        inspectionId: z.string().cuid(),
        notes: z.string().max(2000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { eventId, registrationId } = await eventIdForInspection(
        ctx.db,
        input.inspectionId,
      );
      await assertEventOrganizer(
        ctx.db,
        eventId,
        ctx.user.id,
        SERIES_EVENT_ROLES,
      );

      const updated = await ctx.db.inspection.update({
        where: { id: input.inspectionId },
        data: {
          status: InspectionStatus.REFERRED,
          notes: input.notes,
          completedAt: new Date(),
        },
      });

      const registration = await ctx.db.eventRegistration.findUnique({
        where: { id: registrationId },
        select: { submittedById: true, event: { select: { name: true } } },
      });
      if (registration) {
        await notify(ctx.db, {
          userId: registration.submittedById,
          type: NotificationType.SYSTEM,
          title: `Referred to the stewards — ${registration.event.name}`,
          body: input.notes,
          linkUrl: `/events/${eventId}`,
        });
      }
      return updated;
    }),

  /**
   * Turns a failed card into a penalty, carrying the failed checks into the
   * decision so the stewards' record cites what actually failed.
   */
  raisePenalty: protectedProcedure
    .input(
      z.object({
        inspectionId: z.string().cuid(),
        summary: z.string().min(3).max(300).optional(),
        /**
         * Not every technical failure is a disqualification — a club might
         * exclude a car from one session instead — so the stewards choose.
         */
        type: z.nativeEnum(PenaltyType).default(PenaltyType.DISQUALIFICATION),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const inspection = await ctx.db.inspection.findUnique({
        where: { id: input.inspectionId },
        include: {
          checks: true,
          registration: { select: { id: true, eventId: true } },
        },
      });
      if (!inspection) throw new TRPCError({ code: "NOT_FOUND" });
      await assertEventOrganizer(
        ctx.db,
        inspection.registration.eventId,
        ctx.user.id,
        SERIES_EVENT_ROLES,
      );

      const failed = failedChecks(inspection.checks);
      if (failed.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Nothing on this card failed, so there is nothing to cite.",
        });
      }

      const detail = failed
        .map((checkRecord) => {
          const measured =
            checkRecord.measuredValue !== null
              ? ` (measured ${checkRecord.measuredValue}${checkRecord.measureUnit ?? ""})`
              : "";
          return `${checkRecord.label}${measured}`;
        })
        .join("; ");

      return ctx.db.penalty.create({
        data: {
          eventId: inspection.registration.eventId,
          registrationId: inspection.registration.id,
          issuedById: ctx.user.id,
          type: input.type,
          summary: input.summary ?? "Technical non-compliance",
          details: `Failed technical inspection: ${detail}`,
          regulation: failed.find((c) => c.regulation)?.regulation ?? undefined,
        },
      });
    }),
});
