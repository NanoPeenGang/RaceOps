import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  EventStatus,
  RegistrationStatus,
  SeriesDiscipline,
  SeriesRole,
  VolunteerSignupStatus,
} from "@prisma/client";
import {
  createTRPCRouter,
  protectedProcedure,
  publicProcedure,
} from "@/server/trpc/trpc";
import { slugify } from "@/lib/slug";
import {
  assertSeriesRole,
  getSeriesRole,
  SERIES_ADMIN_ROLES,
} from "@/server/services/series-auth";

export const seriesRouter = createTRPCRouter({
  /** Public directory of series. */
  list: publicProcedure
    .input(
      z.object({
        discipline: z.nativeEnum(SeriesDiscipline).optional(),
        cursor: z.string().cuid().optional(),
        limit: z.number().int().min(1).max(50).default(20),
      }),
    )
    .query(async ({ ctx, input }) => {
      const items = await ctx.db.series.findMany({
        where: input.discipline ? { discipline: input.discipline } : {},
        take: input.limit + 1,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
        orderBy: { createdAt: "desc" },
        include: { _count: { select: { events: true } } },
      });
      let nextCursor: string | undefined;
      if (items.length > input.limit) nextCursor = items.pop()!.id;
      return { items, nextCursor };
    }),

  /** Series the caller organizes. */
  mine: protectedProcedure.query(async ({ ctx }) => {
    const memberships = await ctx.db.seriesMembership.findMany({
      where: { userId: ctx.user.id },
      include: {
        series: { include: { _count: { select: { events: true } } } },
      },
      orderBy: { createdAt: "desc" },
    });
    return memberships.map((m) => ({ ...m.series, myRole: m.role }));
  }),

  /**
   * Series dashboard — "the whole series from one spot". Public fields plus,
   * for organizers, per-event entry and volunteer coverage counts.
   */
  bySlug: publicProcedure
    .input(z.object({ slug: z.string().min(1).max(120) }))
    .query(async ({ ctx, input }) => {
      const series = await ctx.db.series.findUnique({
        where: { slug: input.slug },
        include: {
          organizers: {
            include: {
              user: {
                select: {
                  id: true,
                  profile: { select: { displayName: true } },
                },
              },
            },
          },
          events: {
            orderBy: { date: "asc" },
            include: {
              _count: { select: { registrations: true, volunteerShifts: true } },
            },
          },
        },
      });
      if (!series) throw new TRPCError({ code: "NOT_FOUND" });

      const localUser = ctx.clerkUserId
        ? await ctx.db.user.findUnique({
            where: { authProviderId: ctx.clerkUserId },
            select: { id: true },
          })
        : null;
      const myRole = localUser
        ? await getSeriesRole(ctx.db, series.id, localUser.id)
        : null;

      // Non-organizers only see published events.
      const events = myRole
        ? series.events
        : series.events.filter((e) => e.status !== EventStatus.DRAFT);

      // Aggregate counts drive the dashboard summary.
      const eventIds = events.map((e) => e.id);
      const [confirmedByEvent, volunteerShifts] = await Promise.all([
        eventIds.length
          ? ctx.db.eventRegistration.groupBy({
              by: ["eventId"],
              where: {
                eventId: { in: eventIds },
                status: RegistrationStatus.CONFIRMED,
              },
              _count: { _all: true },
            })
          : Promise.resolve([]),
        eventIds.length
          ? ctx.db.volunteerShift.findMany({
              where: { eventId: { in: eventIds } },
              select: {
                eventId: true,
                capacity: true,
                signups: { select: { status: true } },
              },
            })
          : Promise.resolve([]),
      ]);

      const confirmedMap = new Map(
        confirmedByEvent.map((row) => [row.eventId, row._count._all]),
      );
      const coverageMap = new Map<string, { needed: number; filled: number }>();
      for (const shift of volunteerShifts) {
        const current = coverageMap.get(shift.eventId) ?? {
          needed: 0,
          filled: 0,
        };
        current.needed += shift.capacity;
        current.filled += shift.signups.filter(
          (s) =>
            s.status === VolunteerSignupStatus.SIGNED_UP ||
            s.status === VolunteerSignupStatus.CONFIRMED,
        ).length;
        coverageMap.set(shift.eventId, current);
      }

      return {
        ...series,
        myRole,
        events: events.map((event) => ({
          ...event,
          confirmedEntries: confirmedMap.get(event.id) ?? 0,
          volunteerCoverage: coverageMap.get(event.id) ?? {
            needed: 0,
            filled: 0,
          },
        })),
      };
    }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(2).max(120),
        discipline: z.nativeEnum(SeriesDiscipline),
        platform: z.string().min(1).max(120),
        season: z.string().max(40).optional(),
        description: z.string().max(4000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const slug = slugify(input.name);
      const clash = await ctx.db.series.findFirst({
        where: { OR: [{ name: input.name }, { slug }] },
      });
      if (clash) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "A series with that name already exists.",
        });
      }
      return ctx.db.series.create({
        data: {
          ...input,
          slug,
          organizers: {
            create: { userId: ctx.user.id, role: SeriesRole.OWNER },
          },
        },
      });
    }),

  update: protectedProcedure
    .input(
      z.object({
        seriesId: z.string().cuid(),
        description: z.string().max(4000).nullish(),
        platform: z.string().min(1).max(120).optional(),
        season: z.string().max(40).nullish(),
        logoUrl: z.string().url().nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertSeriesRole(
        ctx.db,
        input.seriesId,
        ctx.user.id,
        SERIES_ADMIN_ROLES,
      );
      const { seriesId, ...data } = input;
      return ctx.db.series.update({ where: { id: seriesId }, data });
    }),

  /** Add or change an organizer's role. */
  setOrganizer: protectedProcedure
    .input(
      z.object({
        seriesId: z.string().cuid(),
        userId: z.string().cuid(),
        role: z.nativeEnum(SeriesRole),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertSeriesRole(
        ctx.db,
        input.seriesId,
        ctx.user.id,
        SERIES_ADMIN_ROLES,
      );
      // Only an OWNER may mint another OWNER.
      if (input.role === SeriesRole.OWNER) {
        await assertSeriesRole(ctx.db, input.seriesId, ctx.user.id, [
          SeriesRole.OWNER,
        ]);
      }
      return ctx.db.seriesMembership.upsert({
        where: {
          seriesId_userId: { seriesId: input.seriesId, userId: input.userId },
        },
        create: {
          seriesId: input.seriesId,
          userId: input.userId,
          role: input.role,
        },
        update: { role: input.role },
      });
    }),

  removeOrganizer: protectedProcedure
    .input(
      z.object({ seriesId: z.string().cuid(), userId: z.string().cuid() }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertSeriesRole(
        ctx.db,
        input.seriesId,
        ctx.user.id,
        SERIES_ADMIN_ROLES,
      );
      const target = await ctx.db.seriesMembership.findUnique({
        where: {
          seriesId_userId: { seriesId: input.seriesId, userId: input.userId },
        },
      });
      if (!target) throw new TRPCError({ code: "NOT_FOUND" });
      if (target.role === SeriesRole.OWNER) {
        const owners = await ctx.db.seriesMembership.count({
          where: { seriesId: input.seriesId, role: SeriesRole.OWNER },
        });
        if (owners <= 1) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "A series must keep at least one owner.",
          });
        }
      }
      await ctx.db.seriesMembership.delete({ where: { id: target.id } });
      return { removed: true };
    }),
});
