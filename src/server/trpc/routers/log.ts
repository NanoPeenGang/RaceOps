import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { LogCategory } from "@prisma/client";
import {
  createTRPCRouter,
  protectedProcedure,
  publicProcedure,
} from "@/server/trpc/trpc";
import {
  assertEventOrganizer,
  assertSeriesRole,
  getSeriesRole,
  SERIES_ADMIN_ROLES,
  SERIES_EVENT_ROLES,
} from "@/server/services/series-auth";
import { bulletinSections, sortLog, summarizeLog } from "@/lib/officials-log";
import { logOfficialAction } from "@/server/services/officials-log";

/**
 * The officials' log and the audit trail.
 *
 * The log is a narrative race control writes and publishes; the audit trail is
 * a record the system keeps whether anyone wants it or not. Both are
 * append-only — there is deliberately no mutation here that edits or deletes a
 * log entry, because a log someone can rewrite is not a log. An error is
 * corrected by a later entry saying so, exactly as a paper log is.
 */

const logInclude = {
  official: {
    select: { id: true, profile: { select: { displayName: true } } },
  },
  session: { select: { id: true, name: true } },
} as const;

export const logRouter = createTRPCRouter({
  /**
   * The event log. Officials see everything including working notes; everyone
   * else sees the published bulletin.
   */
  forEvent: publicProcedure
    .input(
      z.object({
        eventId: z.string().cuid(),
        sessionId: z.string().cuid().optional(),
        category: z.nativeEnum(LogCategory).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const event = await ctx.db.raceEvent.findUnique({
        where: { id: input.eventId },
        select: { id: true, name: true, seriesId: true },
      });
      if (!event) throw new TRPCError({ code: "NOT_FOUND" });

      const localUser = ctx.clerkUserId
        ? await ctx.db.user.findUnique({
            where: { authProviderId: ctx.clerkUserId },
            select: { id: true },
          })
        : null;
      const role =
        localUser && event.seriesId
          ? await getSeriesRole(ctx.db, event.seriesId, localUser.id)
          : null;
      const isOfficial = Boolean(role && SERIES_EVENT_ROLES.roles.includes(role));

      const entries = await ctx.db.officialLogEntry.findMany({
        where: {
          eventId: input.eventId,
          ...(isOfficial ? {} : { published: true }),
          ...(input.sessionId ? { sessionId: input.sessionId } : {}),
          ...(input.category ? { category: input.category } : {}),
        },
        include: logInclude,
      });

      return {
        event: { id: event.id, name: event.name },
        entries: sortLog(entries),
        summary: summarizeLog(entries),
        isOfficial,
      };
    }),

  /**
   * The end-of-meeting bulletin: the published log, grouped by category.
   * Public — that is what publishing means.
   */
  bulletin: publicProcedure
    .input(z.object({ eventId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      const event = await ctx.db.raceEvent.findUnique({
        where: { id: input.eventId },
        select: {
          id: true,
          name: true,
          date: true,
          venue: true,
          series: { select: { name: true } },
          trackLayout: {
            select: { name: true, track: { select: { name: true } } },
          },
        },
      });
      if (!event) throw new TRPCError({ code: "NOT_FOUND" });

      const entries = await ctx.db.officialLogEntry.findMany({
        where: { eventId: input.eventId, published: true },
        include: logInclude,
      });

      return { event, sections: bulletinSections(entries) };
    }),

  /**
   * Add an entry by hand — the things the system cannot see. "Driver briefing
   * held", "circuit inspected after rain", "clerk of the course spoke to car
   * 42": all of it belongs in the log and none of it produces a database row
   * on its own.
   */
  add: protectedProcedure
    .input(
      z.object({
        eventId: z.string().cuid(),
        sessionId: z.string().cuid().optional(),
        category: z.nativeEnum(LogCategory).default(LogCategory.NOTE),
        summary: z.string().min(3).max(300),
        detail: z.string().max(4000).optional(),
        /// Backdating something written on the clipboard an hour ago.
        occurredAt: z.date().optional(),
        published: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertEventOrganizer(
        ctx.db,
        input.eventId,
        ctx.user.id,
        SERIES_EVENT_ROLES,
      );
      if (input.sessionId) {
        const session = await ctx.db.eventSession.findUnique({
          where: { id: input.sessionId },
          select: { eventId: true },
        });
        if (!session || session.eventId !== input.eventId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "That session is not part of this event.",
          });
        }
      }
      return ctx.db.officialLogEntry.create({
        data: {
          ...input,
          officialId: ctx.user.id,
          automatic: false,
        },
        include: logInclude,
      });
    }),

  /**
   * Move an entry in or out of the bulletin.
   *
   * The only edit the log allows, and deliberately so: it changes who can read
   * an entry, not what it says. Race control's working note about a car it was
   * watching stays internal; the decision that followed is published.
   */
  setPublished: protectedProcedure
    .input(
      z.object({
        entryId: z.string().cuid(),
        published: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const entry = await ctx.db.officialLogEntry.findUnique({
        where: { id: input.entryId },
        select: { eventId: true },
      });
      if (!entry) throw new TRPCError({ code: "NOT_FOUND" });
      await assertEventOrganizer(
        ctx.db,
        entry.eventId,
        ctx.user.id,
        SERIES_EVENT_ROLES,
      );
      return ctx.db.officialLogEntry.update({
        where: { id: input.entryId },
        data: { published: input.published },
      });
    }),

  /** Publish the whole log at once — the end-of-meeting action. */
  publishBulletin: protectedProcedure
    .input(z.object({ eventId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertEventOrganizer(
        ctx.db,
        input.eventId,
        ctx.user.id,
        SERIES_EVENT_ROLES,
      );
      // Hand-written internal notes stay internal: publishing the bulletin
      // should not accidentally release race control's working commentary.
      const result = await ctx.db.officialLogEntry.updateMany({
        where: {
          eventId: input.eventId,
          published: false,
          automatic: true,
        },
        data: { published: true },
      });
      await logOfficialAction(ctx.db, {
        eventId: input.eventId,
        category: LogCategory.DOCUMENT,
        summary: "End-of-meeting bulletin published",
        officialId: ctx.user.id,
        published: true,
      });
      return { published: result.count };
    }),

  /**
   * The audit trail for an event or a single record.
   *
   * Owner/admin only. Race control can run a meeting; who reads the record of
   * everyone's changes is a different question, and the people who might be
   * disputed are exactly the people who should not control the view of it.
   */
  audit: protectedProcedure
    .input(
      z.object({
        eventId: z.string().cuid().optional(),
        seriesId: z.string().cuid().optional(),
        entityType: z.string().max(60).optional(),
        entityId: z.string().cuid().optional(),
        limit: z.number().int().min(1).max(200).default(50),
        cursor: z.string().cuid().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      if (!input.eventId && !input.seriesId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Ask for an event's or a series' audit trail.",
        });
      }

      if (input.eventId) {
        await assertEventOrganizer(
          ctx.db,
          input.eventId,
          ctx.user.id,
          SERIES_ADMIN_ROLES,
        );
      }
      if (input.seriesId) {
        await assertSeriesRole(
          ctx.db,
          input.seriesId,
          ctx.user.id,
          SERIES_ADMIN_ROLES,
        );
      }

      const items = await ctx.db.auditEvent.findMany({
        where: {
          ...(input.eventId ? { eventId: input.eventId } : {}),
          ...(input.seriesId ? { seriesId: input.seriesId } : {}),
          ...(input.entityType ? { entityType: input.entityType } : {}),
          ...(input.entityId ? { entityId: input.entityId } : {}),
        },
        take: input.limit + 1,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
        orderBy: { createdAt: "desc" },
        include: {
          actor: {
            select: { id: true, profile: { select: { displayName: true } } },
          },
        },
      });
      let nextCursor: string | undefined;
      if (items.length > input.limit) nextCursor = items.pop()!.id;
      return { items, nextCursor };
    }),
});
