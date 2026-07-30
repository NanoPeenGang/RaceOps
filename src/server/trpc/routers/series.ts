import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  EventStatus,
  NotificationType,
  Prisma,
  RegistrationStatus,
  SeriesDiscipline,
  SeriesRole,
  VolunteerSignupStatus,
} from "@prisma/client";
import { notify } from "@/server/services/notifications";
import {
  createTRPCRouter,
  protectedProcedure,
  publicProcedure,
} from "@/server/trpc/trpc";
import { slugify } from "@/lib/slug";
import {
  assertEventOrganizer,
  assertSeriesRole,
  getSeriesRole,
  SERIES_ADMIN_ROLES,
  SERIES_EVENT_ROLES,
} from "@/server/services/series-auth";
import { computeSeriesStandings } from "@/server/services/standings";

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

  /** Championship standings — public. */
  standings: publicProcedure
    .input(z.object({ seriesId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      const standings = await computeSeriesStandings(ctx.db, input.seriesId);
      if (!standings) throw new TRPCError({ code: "NOT_FOUND" });
      return standings;
    }),

  /** Configure the points scheme (organizers). */
  setPointsScheme: protectedProcedure
    .input(
      z.object({
        seriesId: z.string().cuid(),
        // Position -> points, e.g. { "1": 25, "2": 18 }
        scheme: z.record(z.string(), z.number().int().min(0).max(1000)),
        fastestLapPoints: z.number().int().min(0).max(100).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertSeriesRole(
        ctx.db,
        input.seriesId,
        ctx.user.id,
        SERIES_ADMIN_ROLES,
      );
      return ctx.db.series.update({
        where: { id: input.seriesId },
        data: {
          pointsScheme: input.scheme,
          fastestLapPoints: input.fastestLapPoints ?? null,
        },
      });
    }),

  /**
   * Championship rules beyond the points scale: dropped scores and the starts
   * needed to be eligible for the title.
   */
  setChampionshipRules: protectedProcedure
    .input(
      z.object({
        seriesId: z.string().cuid(),
        countBestRounds: z.number().int().min(1).max(100).nullish(),
        minStartsForTitle: z.number().int().min(1).max(100).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { seriesId, ...data } = input;
      await assertSeriesRole(ctx.db, seriesId, ctx.user.id, SERIES_ADMIN_ROLES);
      return ctx.db.series.update({ where: { id: seriesId }, data });
    }),

  // -------------------------------------------------------------------------
  // Classes
  // -------------------------------------------------------------------------

  /**
   * A series' classes. Free-form by design: a club autocross region runs
   * dozens with local names, a pro grid runs two, and a single-grid series
   * declares none at all.
   */
  classes: publicProcedure
    .input(z.object({ seriesId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.db.seriesClass.findMany({
        where: { seriesId: input.seriesId },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        include: { _count: { select: { registrations: true } } },
      });
    }),

  createClass: protectedProcedure
    .input(
      z.object({
        seriesId: z.string().cuid(),
        name: z.string().min(1).max(120),
        code: z.string().max(20).optional(),
        grouping: z.string().max(80).optional(),
        sortOrder: z.number().int().min(0).max(9999).default(0),
        pointsScheme: z
          .record(z.string(), z.number().int().min(0).max(1000))
          .optional(),
        fastestLapPoints: z.number().int().min(0).max(100).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { seriesId, ...data } = input;
      await assertSeriesRole(ctx.db, seriesId, ctx.user.id, SERIES_ADMIN_ROLES);

      const clash = await ctx.db.seriesClass.findFirst({
        where: { seriesId, name: data.name },
        select: { id: true },
      });
      if (clash) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `This series already has a class called "${data.name}".`,
        });
      }
      return ctx.db.seriesClass.create({ data: { ...data, seriesId } });
    }),

  updateClass: protectedProcedure
    .input(
      z.object({
        classId: z.string().cuid(),
        name: z.string().min(1).max(120).optional(),
        code: z.string().max(20).nullish(),
        grouping: z.string().max(80).nullish(),
        sortOrder: z.number().int().min(0).max(9999).optional(),
        pointsScheme: z
          .record(z.string(), z.number().int().min(0).max(1000))
          .nullish(),
        fastestLapPoints: z.number().int().min(0).max(100).nullish(),
        active: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { classId, ...data } = input;
      const existing = await ctx.db.seriesClass.findUnique({
        where: { id: classId },
        select: { seriesId: true },
      });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      await assertSeriesRole(
        ctx.db,
        existing.seriesId,
        ctx.user.id,
        SERIES_ADMIN_ROLES,
      );

      if (data.name) {
        const clash = await ctx.db.seriesClass.findFirst({
          where: { seriesId: existing.seriesId, name: data.name, NOT: { id: classId } },
          select: { id: true },
        });
        if (clash) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `This series already has a class called "${data.name}".`,
          });
        }
      }
      // Prisma distinguishes "leave the JSON alone" from "set it to null", so
      // clearing a per-class scale needs DbNull rather than a bare null.
      const { pointsScheme, ...rest } = data;
      return ctx.db.seriesClass.update({
        where: { id: classId },
        data: {
          ...rest,
          ...(pointsScheme === undefined
            ? {}
            : { pointsScheme: pointsScheme ?? Prisma.DbNull }),
        },
      });
    }),

  /**
   * Removes a class. Entries fall back to unclassified (SetNull) rather than
   * being deleted, so results survive — retiring a class mid-season is better
   * served by marking it inactive.
   */
  deleteClass: protectedProcedure
    .input(z.object({ classId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.seriesClass.findUnique({
        where: { id: input.classId },
        select: { seriesId: true, _count: { select: { registrations: true } } },
      });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      await assertSeriesRole(
        ctx.db,
        existing.seriesId,
        ctx.user.id,
        SERIES_ADMIN_ROLES,
      );
      await ctx.db.seriesClass.delete({ where: { id: input.classId } });
      return { deleted: true, unclassifiedEntries: existing._count.registrations };
    }),

  /** Assigns an entry to a class. Race control or series admin. */
  setEntryClass: protectedProcedure
    .input(
      z.object({
        registrationId: z.string().cuid(),
        seriesClassId: z.string().cuid().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const registration = await ctx.db.eventRegistration.findUnique({
        where: { id: input.registrationId },
        select: { id: true, event: { select: { seriesId: true } } },
      });
      if (!registration?.event.seriesId) throw new TRPCError({ code: "NOT_FOUND" });
      await assertSeriesRole(
        ctx.db,
        registration.event.seriesId,
        ctx.user.id,
        SERIES_EVENT_ROLES,
      );

      if (input.seriesClassId) {
        // A class from another series would silently corrupt that series'
        // standings, so the ownership check is not optional.
        const target = await ctx.db.seriesClass.findUnique({
          where: { id: input.seriesClassId },
          select: { seriesId: true, name: true },
        });
        if (!target || target.seriesId !== registration.event.seriesId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "That class belongs to a different series.",
          });
        }
      }

      return ctx.db.eventRegistration.update({
        where: { id: input.registrationId },
        data: { seriesClassId: input.seriesClassId },
      });
    }),

  /** Weighting for one round, e.g. a double-points finale. */
  setEventPointsMultiplier: protectedProcedure
    .input(
      z.object({
        eventId: z.string().cuid(),
        pointsMultiplier: z.number().min(0.1).max(10),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertEventOrganizer(
        ctx.db,
        input.eventId,
        ctx.user.id,
        SERIES_ADMIN_ROLES,
      );
      return ctx.db.raceEvent.update({
        where: { id: input.eventId },
        data: { pointsMultiplier: input.pointsMultiplier },
      });
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

  /**
   * What deleting this series would destroy. Shown before the irreversible
   * action so an organizer can see the blast radius.
   */
  deletionImpact: protectedProcedure
    .input(z.object({ seriesId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      await assertSeriesRole(ctx.db, input.seriesId, ctx.user.id, [
        SeriesRole.OWNER,
      ]);
      const series = await ctx.db.series.findUnique({
        where: { id: input.seriesId },
        select: { name: true },
      });
      if (!series) throw new TRPCError({ code: "NOT_FOUND" });

      const eventIds = (
        await ctx.db.raceEvent.findMany({
          where: { seriesId: input.seriesId },
          select: { id: true },
        })
      ).map((e) => e.id);

      const [registrations, results, penalties, volunteerShifts, media] =
        await Promise.all([
          ctx.db.eventRegistration.count({
            where: { eventId: { in: eventIds } },
          }),
          ctx.db.eventResult.count({ where: { eventId: { in: eventIds } } }),
          ctx.db.penalty.count({ where: { eventId: { in: eventIds } } }),
          ctx.db.volunteerShift.count({ where: { eventId: { in: eventIds } } }),
          ctx.db.media.count({
            where: {
              OR: [
                { seriesId: input.seriesId },
                { eventId: { in: eventIds } },
              ],
            },
          }),
        ]);

      return {
        name: series.name,
        events: eventIds.length,
        registrations,
        results,
        penalties,
        volunteerShifts,
        media,
      };
    }),

  /**
   * Permanently delete a series and everything under it. Owner-only and
   * guarded by retyping the series name.
   *
   * Events are removed explicitly rather than left to the database: the
   * RaceEvent -> Series relation is SET NULL, so a bare series delete would
   * orphan its events, and an event with no series has no organizer chain —
   * nobody could manage or remove it afterwards.
   */
  delete: protectedProcedure
    .input(
      z.object({
        seriesId: z.string().cuid(),
        /** Must match the series name exactly. */
        confirmName: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertSeriesRole(ctx.db, input.seriesId, ctx.user.id, [
        SeriesRole.OWNER,
      ]);
      const series = await ctx.db.series.findUnique({
        where: { id: input.seriesId },
        include: { organizers: { select: { userId: true } } },
      });
      if (!series) throw new TRPCError({ code: "NOT_FOUND" });
      if (input.confirmName !== series.name) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "The name you typed does not match this series.",
        });
      }

      // Tell entrants before their events disappear.
      const affected = await ctx.db.eventRegistration.findMany({
        where: {
          event: { seriesId: input.seriesId },
          status: {
            in: [
              RegistrationStatus.PENDING,
              RegistrationStatus.CONFIRMED,
              RegistrationStatus.WAITLISTED,
            ],
          },
        },
        select: { submittedById: true },
      });

      await ctx.db.$transaction([
        ctx.db.raceEvent.deleteMany({ where: { seriesId: input.seriesId } }),
        ctx.db.series.delete({ where: { id: input.seriesId } }),
      ]);

      const recipients = new Set<string>([
        ...affected.map((r) => r.submittedById),
        ...series.organizers.map((o) => o.userId),
      ]);
      recipients.delete(ctx.user.id);
      await Promise.all(
        [...recipients].map((userId) =>
          notify(ctx.db, {
            userId,
            type: NotificationType.SYSTEM,
            title: `Series deleted: ${series.name}`,
            body: "All of its events and entries have been removed.",
          }),
        ),
      );
      return { deleted: true, name: series.name };
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
