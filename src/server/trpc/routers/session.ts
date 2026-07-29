import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  FlagState,
  SessionStatus,
  SessionType,
  TimingStatus,
} from "@prisma/client";
import {
  createTRPCRouter,
  protectedProcedure,
  publicProcedure,
} from "@/server/trpc/trpc";
import {
  assertEventOrganizer,
  SERIES_EVENT_ROLES,
} from "@/server/services/series-auth";
import { parseLapTime } from "@/lib/lap-time";
import { broadcastTimingUpdate } from "@/server/services/realtime";

/**
 * Event running order (multi-day schedules) and live timing.
 * Sessions are the unit both hang off: a weekend is a list of sessions, and
 * each session carries its own timing board and flag state.
 */
export const sessionRouter = createTRPCRouter({
  /** Full running order for an event — public. */
  forEvent: publicProcedure
    .input(z.object({ eventId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.db.eventSession.findMany({
        where: { eventId: input.eventId },
        orderBy: { startsAt: "asc" },
        include: { _count: { select: { timingEntries: true } } },
      });
    }),

  create: protectedProcedure
    .input(
      z.object({
        eventId: z.string().cuid(),
        type: z.nativeEnum(SessionType),
        name: z.string().min(1).max(120),
        startsAt: z.date(),
        endsAt: z.date(),
        location: z.string().max(160).optional(),
        notes: z.string().max(4000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertEventOrganizer(
        ctx.db,
        input.eventId,
        ctx.user.id,
        SERIES_EVENT_ROLES,
      );
      if (input.startsAt >= input.endsAt) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "A session must start before it ends.",
        });
      }
      return ctx.db.eventSession.create({ data: input });
    }),

  update: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().cuid(),
        name: z.string().min(1).max(120).optional(),
        startsAt: z.date().optional(),
        endsAt: z.date().optional(),
        location: z.string().max(160).nullish(),
        notes: z.string().max(4000).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const session = await ctx.db.eventSession.findUnique({
        where: { id: input.sessionId },
      });
      if (!session) throw new TRPCError({ code: "NOT_FOUND" });
      await assertEventOrganizer(
        ctx.db,
        session.eventId,
        ctx.user.id,
        SERIES_EVENT_ROLES,
      );
      const startsAt = input.startsAt ?? session.startsAt;
      const endsAt = input.endsAt ?? session.endsAt;
      if (startsAt >= endsAt) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "A session must start before it ends.",
        });
      }
      const { sessionId, ...data } = input;
      return ctx.db.eventSession.update({ where: { id: sessionId }, data });
    }),

  delete: protectedProcedure
    .input(z.object({ sessionId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const session = await ctx.db.eventSession.findUnique({
        where: { id: input.sessionId },
        select: { eventId: true },
      });
      if (!session) throw new TRPCError({ code: "NOT_FOUND" });
      await assertEventOrganizer(
        ctx.db,
        session.eventId,
        ctx.user.id,
        SERIES_EVENT_ROLES,
      );
      await ctx.db.eventSession.delete({ where: { id: input.sessionId } });
      return { deleted: true };
    }),

  // -------------------------------------------------------------------------
  // Live control
  // -------------------------------------------------------------------------

  /** Start/finish a session and set the flag shown on the live board. */
  setLiveState: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().cuid(),
        status: z.nativeEnum(SessionStatus).optional(),
        flagState: z.nativeEnum(FlagState).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const session = await ctx.db.eventSession.findUnique({
        where: { id: input.sessionId },
        select: { eventId: true },
      });
      if (!session) throw new TRPCError({ code: "NOT_FOUND" });
      await assertEventOrganizer(
        ctx.db,
        session.eventId,
        ctx.user.id,
        SERIES_EVENT_ROLES,
      );
      const updated = await ctx.db.eventSession.update({
        where: { id: input.sessionId },
        data: {
          ...(input.status ? { status: input.status } : {}),
          ...(input.flagState ? { flagState: input.flagState } : {}),
        },
      });
      await broadcastTimingUpdate(input.sessionId);
      return updated;
    }),

  /** Live timing board for a session — public, polled by viewers. */
  timing: publicProcedure
    .input(z.object({ sessionId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      const session = await ctx.db.eventSession.findUnique({
        where: { id: input.sessionId },
        include: { event: { select: { id: true, name: true } } },
      });
      if (!session) throw new TRPCError({ code: "NOT_FOUND" });

      const entries = await ctx.db.timingEntry.findMany({
        where: { sessionId: input.sessionId },
        include: {
          registration: {
            select: {
              id: true,
              carNumber: true,
              carClass: true,
              team: { select: { id: true, name: true } },
              entrantUser: {
                select: { profile: { select: { displayName: true } } },
              },
            },
          },
        },
      });

      return {
        session,
        entries: entries.map((entry) => ({
          ...entry,
          competitorLabel:
            entry.registration.team?.name ??
            entry.registration.entrantUser?.profile?.displayName ??
            "Entry",
        })),
      };
    }),

  /**
   * Push a timing update for one entry. Timing officials call this from the
   * console; viewers pick it up by polling (and over the realtime channel
   * when one is configured).
   */
  pushTiming: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().cuid(),
        registrationId: z.string().cuid(),
        position: z.number().int().min(1).max(200).nullish(),
        lapsCompleted: z.number().int().min(0).max(10000).optional(),
        /** Accepts "1:23.456", "83.456" or raw milliseconds. */
        lastLap: z.string().max(20).nullish(),
        bestLap: z.string().max(20).nullish(),
        gapSeconds: z.number().min(0).max(86400).nullish(),
        status: z.nativeEnum(TimingStatus).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const session = await ctx.db.eventSession.findUnique({
        where: { id: input.sessionId },
        select: { eventId: true },
      });
      if (!session) throw new TRPCError({ code: "NOT_FOUND" });
      await assertEventOrganizer(
        ctx.db,
        session.eventId,
        ctx.user.id,
        SERIES_EVENT_ROLES,
      );

      // The entry must belong to this session's event.
      const registration = await ctx.db.eventRegistration.findUnique({
        where: { id: input.registrationId },
        select: { eventId: true },
      });
      if (!registration || registration.eventId !== session.eventId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "That entry is not part of this event.",
        });
      }

      const lastLapMs = input.lastLap ? parseLapTime(input.lastLap) : null;
      const bestLapMs = input.bestLap ? parseLapTime(input.bestLap) : null;
      if (input.lastLap && lastLapMs === null) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Could not read the lap time "${input.lastLap}".`,
        });
      }
      if (input.bestLap && bestLapMs === null) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Could not read the lap time "${input.bestLap}".`,
        });
      }

      const existing = await ctx.db.timingEntry.findUnique({
        where: {
          sessionId_registrationId: {
            sessionId: input.sessionId,
            registrationId: input.registrationId,
          },
        },
        select: { bestLapMs: true },
      });

      /**
       * An explicit best lap wins (a timing export knows the real value).
       * Otherwise the lap just posted only becomes the best when it is
       * quicker, so pushing a slow lap never wipes out a personal best.
       */
      const resolvedBestLapMs =
        input.bestLap !== undefined
          ? bestLapMs
          : lastLapMs !== null &&
              (existing?.bestLapMs == null || lastLapMs < existing.bestLapMs)
            ? lastLapMs
            : undefined;

      const data = {
        position: input.position ?? null,
        ...(input.lapsCompleted !== undefined
          ? { lapsCompleted: input.lapsCompleted }
          : {}),
        ...(input.lastLap !== undefined ? { lastLapMs } : {}),
        ...(resolvedBestLapMs !== undefined
          ? { bestLapMs: resolvedBestLapMs }
          : {}),
        ...(input.gapSeconds !== undefined
          ? {
              gapMs:
                input.gapSeconds === null
                  ? null
                  : Math.round(input.gapSeconds * 1000),
            }
          : {}),
        ...(input.status ? { status: input.status } : {}),
      };

      const entry = await ctx.db.timingEntry.upsert({
        where: {
          sessionId_registrationId: {
            sessionId: input.sessionId,
            registrationId: input.registrationId,
          },
        },
        create: {
          sessionId: input.sessionId,
          registrationId: input.registrationId,
          ...data,
        },
        update: data,
      });
      await broadcastTimingUpdate(input.sessionId);
      return entry;
    }),

  /** Seed the board with every confirmed entry so officials can fill it in. */
  seedTiming: protectedProcedure
    .input(z.object({ sessionId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const session = await ctx.db.eventSession.findUnique({
        where: { id: input.sessionId },
        select: { eventId: true },
      });
      if (!session) throw new TRPCError({ code: "NOT_FOUND" });
      await assertEventOrganizer(
        ctx.db,
        session.eventId,
        ctx.user.id,
        SERIES_EVENT_ROLES,
      );

      const registrations = await ctx.db.eventRegistration.findMany({
        where: { eventId: session.eventId, status: "CONFIRMED" },
        select: { id: true },
      });
      await ctx.db.timingEntry.createMany({
        data: registrations.map((registration) => ({
          sessionId: input.sessionId,
          registrationId: registration.id,
        })),
        skipDuplicates: true,
      });
      await broadcastTimingUpdate(input.sessionId);
      return { seeded: registrations.length };
    }),

  /** Sessions currently running across the whole platform. */
  liveNow: publicProcedure.query(async ({ ctx }) => {
    return ctx.db.eventSession.findMany({
      where: { status: SessionStatus.LIVE },
      orderBy: { startsAt: "asc" },
      take: 20,
      include: {
        event: {
          select: {
            id: true,
            name: true,
            series: { select: { name: true, slug: true } },
          },
        },
      },
    });
  }),
});
