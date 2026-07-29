import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  createTRPCRouter,
  protectedProcedure,
  publicProcedure,
} from "@/server/trpc/trpc";

/**
 * Race reports — long-form post-race writeups. An author drafts a report,
 * optionally against an event they took part in or organized, attaches media,
 * and publishes it. Drafts are visible only to their author.
 */
export const reportRouter = createTRPCRouter({
  /** Published reports, newest first. Optionally narrowed to one event. */
  feed: publicProcedure
    .input(
      z.object({
        eventId: z.string().cuid().optional(),
        tag: z.string().max(40).optional(),
        limit: z.number().int().min(1).max(50).default(20),
        cursor: z.string().cuid().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const reports = await ctx.db.raceReport.findMany({
        where: {
          published: true,
          ...(input.eventId ? { eventId: input.eventId } : {}),
          ...(input.tag ? { tags: { has: input.tag } } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: input.limit + 1,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
        include: {
          author: {
            select: {
              id: true,
              profile: {
                select: { displayName: true },
              },
            },
          },
          event: { select: { id: true, name: true, date: true } },
          _count: { select: { mediaAttachments: true } },
        },
      });

      const nextCursor =
        reports.length > input.limit ? reports.pop()!.id : undefined;
      return { reports, nextCursor };
    }),

  /** One report. Drafts are readable only by their author. */
  byId: publicProcedure
    .input(z.object({ reportId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      const report = await ctx.db.raceReport.findUnique({
        where: { id: input.reportId },
        include: {
          author: {
            select: {
              id: true,
              authProviderId: true,
              profile: {
                select: { displayName: true },
              },
            },
          },
          event: {
            select: {
              id: true,
              name: true,
              date: true,
              series: { select: { name: true, slug: true } },
            },
          },
        },
      });
      if (!report) throw new TRPCError({ code: "NOT_FOUND" });

      const isAuthor =
        ctx.clerkUserId !== null &&
        ctx.clerkUserId === report.author.authProviderId;
      if (!report.published && !isAuthor) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      const { author, ...rest } = report;
      return {
        ...rest,
        author: { id: author.id, profile: author.profile },
        isAuthor,
      };
    }),

  /** The signed-in author's own reports, drafts included. */
  mine: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db.raceReport.findMany({
      where: { authorId: ctx.user.id },
      orderBy: { updatedAt: "desc" },
      include: { event: { select: { id: true, name: true } } },
    });
  }),

  create: protectedProcedure
    .input(
      z.object({
        title: z.string().min(3).max(200),
        body: z.string().min(1).max(50_000),
        eventId: z.string().cuid().optional(),
        tags: z.array(z.string().min(1).max(40)).max(10).default([]),
        published: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.eventId) {
        const event = await ctx.db.raceEvent.findUnique({
          where: { id: input.eventId },
          select: { id: true },
        });
        if (!event) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "That event does not exist.",
          });
        }
      }
      return ctx.db.raceReport.create({
        data: {
          authorId: ctx.user.id,
          title: input.title,
          body: input.body,
          eventId: input.eventId,
          tags: normalizeTags(input.tags),
          published: input.published,
        },
      });
    }),

  update: protectedProcedure
    .input(
      z.object({
        reportId: z.string().cuid(),
        title: z.string().min(3).max(200).optional(),
        body: z.string().min(1).max(50_000).optional(),
        eventId: z.string().cuid().nullish(),
        tags: z.array(z.string().min(1).max(40)).max(10).optional(),
        published: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { reportId, tags, ...rest } = input;
      // Scoped by authorId so another user's report can never be edited.
      const result = await ctx.db.raceReport.updateMany({
        where: { id: reportId, authorId: ctx.user.id },
        data: {
          ...rest,
          ...(tags ? { tags: normalizeTags(tags) } : {}),
        },
      });
      if (result.count === 0) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You can only edit your own reports.",
        });
      }
      return ctx.db.raceReport.findUniqueOrThrow({ where: { id: reportId } });
    }),

  remove: protectedProcedure
    .input(z.object({ reportId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.db.raceReport.deleteMany({
        where: { id: input.reportId, authorId: ctx.user.id },
      });
      if (result.count === 0) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You can only delete your own reports.",
        });
      }
      return { deleted: true };
    }),
});

/** Lower-cases, trims and de-duplicates tags so filters match reliably. */
function normalizeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  for (const tag of tags) {
    const clean = tag.trim().toLowerCase();
    if (clean) seen.add(clean);
  }
  return [...seen];
}
