import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  IncidentSource,
  IncidentStatus,
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
  getSeriesRole,
  SERIES_PENALTY_ROLES,
} from "@/server/services/series-auth";
import { TEAM_MANAGER_ROLES } from "@/lib/teams";
import {
  canIssuePenaltyFor,
  canTransitionIncident,
  INCIDENT_STATUS_LABELS,
  isIncidentOpen,
  sortIncidentQueue,
  summarizeQueue,
} from "@/lib/incidents";
import { notify } from "@/server/services/notifications";

/**
 * Incident reports and the stewards' queue.
 *
 * This is the missing front half of stewarding: penalties used to appear from
 * nowhere. A competitor, a marshal post or race control files what happened,
 * and officials triage the queue through to a decision — no further action, or
 * a penalty that carries the report with it.
 */

/** Whether the caller may act for an entry, for filing and replying. */
async function canActForRegistration(
  db: PrismaClient,
  registrationId: string,
  userId: string,
): Promise<boolean> {
  const registration = await db.eventRegistration.findUnique({
    where: { id: registrationId },
    select: {
      teamId: true,
      entrantUserId: true,
      submittedById: true,
      lineup: { select: { userId: true } },
    },
  });
  if (!registration) return false;
  if (
    registration.submittedById === userId ||
    registration.entrantUserId === userId ||
    registration.lineup.some((driver) => driver.userId === userId)
  ) {
    return true;
  }
  if (!registration.teamId) return false;
  const membership = await db.teamMembership.findUnique({
    where: { teamId_userId: { teamId: registration.teamId, userId } },
    select: { role: true, endDate: true },
  });
  return Boolean(
    membership &&
      membership.endDate === null &&
      TEAM_MANAGER_ROLES.includes(membership.role),
  );
}

/** Race control and stewards, who work the queue. */
async function assertOfficial(
  db: PrismaClient,
  eventId: string,
  userId: string,
): Promise<void> {
  await assertEventOrganizer(db, eventId, userId, SERIES_PENALTY_ROLES);
}

const incidentInclude = {
  subject: {
    select: {
      id: true,
      carNumber: true,
      team: { select: { id: true, name: true } },
      entrantUser: { select: { profile: { select: { displayName: true } } } },
    },
  },
  reportedBy: {
    select: { id: true, profile: { select: { displayName: true } } },
  },
  decidedBy: {
    select: { id: true, profile: { select: { displayName: true } } },
  },
  penalty: { select: { id: true, type: true, summary: true, status: true } },
  session: { select: { id: true, name: true } },
  turn: { select: { id: true, number: true, name: true, marshalPost: true } },
} as const;

export const incidentRouter = createTRPCRouter({
  /**
   * The queue for an event. Officials see everything; everyone else sees the
   * reports that have been decided, since a stewards' decision is a public
   * record but an open investigation is not.
   */
  forEvent: publicProcedure
    .input(z.object({ eventId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      const event = await ctx.db.raceEvent.findUnique({
        where: { id: input.eventId },
        select: { seriesId: true },
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
      const isOfficial = Boolean(role && SERIES_PENALTY_ROLES.includes(role));

      const rows = await ctx.db.incident.findMany({
        where: {
          eventId: input.eventId,
          // An open investigation is not a public record; a decision is.
          ...(isOfficial
            ? {}
            : {
                status: {
                  in: [
                    IncidentStatus.NO_FURTHER_ACTION,
                    IncidentStatus.PENALTY_ISSUED,
                  ],
                },
              }),
        },
        include: incidentInclude,
      });

      return {
        incidents: sortIncidentQueue(rows),
        summary: summarizeQueue(rows),
        isOfficial,
      };
    }),

  byId: publicProcedure
    .input(z.object({ incidentId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      const incident = await ctx.db.incident.findUnique({
        where: { id: input.incidentId },
        include: {
          ...incidentInclude,
          responses: {
            orderBy: { createdAt: "asc" },
            include: {
              author: {
                select: { id: true, profile: { select: { displayName: true } } },
              },
            },
          },
          media: { orderBy: { createdAt: "asc" } },
          event: { select: { id: true, name: true, seriesId: true } },
        },
      });
      if (!incident) throw new TRPCError({ code: "NOT_FOUND" });

      const localUser = ctx.clerkUserId
        ? await ctx.db.user.findUnique({
            where: { authProviderId: ctx.clerkUserId },
            select: { id: true },
          })
        : null;
      const role =
        localUser && incident.event.seriesId
          ? await getSeriesRole(ctx.db, incident.event.seriesId, localUser.id)
          : null;
      const isOfficial = Boolean(role && SERIES_PENALTY_ROLES.includes(role));

      const involved =
        localUser !== null &&
        (incident.reportedById === localUser.id ||
          (incident.subjectRegistrationId !== null &&
            (await canActForRegistration(
              ctx.db,
              incident.subjectRegistrationId,
              localUser.id,
            ))));

      if (!isOfficial && !involved && isIncidentOpen(incident.status)) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      return {
        ...incident,
        // Internal notes stay internal until the report is closed.
        responses: incident.responses.filter(
          (response) =>
            response.visibleToCompetitors || isOfficial,
        ),
        isOfficial,
        involved,
      };
    }),

  /**
   * File a report. Open to anyone signed in — a marshal, a competitor or an
   * official — because the queue's value is that anything can be reported into
   * it. Filing against an entry you have no connection to is normal: that is
   * what reporting another car means.
   */
  file: protectedProcedure
    .input(
      z.object({
        eventId: z.string().cuid(),
        sessionId: z.string().cuid().optional(),
        subjectRegistrationId: z.string().cuid().optional(),
        reportedByRegistrationId: z.string().cuid().optional(),
        source: z.nativeEnum(IncidentSource).default(IncidentSource.COMPETITOR),
        summary: z.string().min(5).max(300),
        description: z.string().max(8000).optional(),
        lapNumber: z.number().int().min(0).max(10000).optional(),
        location: z.string().max(160).optional(),
        /// The named corner, where the event runs a layout with turns defined.
        turnId: z.string().cuid().optional(),
        occurredAt: z.date().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const event = await ctx.db.raceEvent.findUnique({
        where: { id: input.eventId },
        select: { id: true, name: true, seriesId: true, trackLayoutId: true },
      });
      if (!event) throw new TRPCError({ code: "NOT_FOUND" });

      // A turn from another circuit would read as a plausible corner on the
      // report and point stewards at the wrong marshal post.
      if (input.turnId) {
        const turn = await ctx.db.trackTurn.findUnique({
          where: { id: input.turnId },
          select: { layoutId: true },
        });
        if (!turn || turn.layoutId !== event.trackLayoutId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "That corner is not on this event's track layout.",
          });
        }
      }

      // Only an official can file as race control or as a marshal post, and
      // only the entry itself can file on its own behalf.
      const role =
        event.seriesId &&
        (await getSeriesRole(ctx.db, event.seriesId, ctx.user.id));
      const isOfficial = Boolean(role && SERIES_PENALTY_ROLES.includes(role));

      if (
        !isOfficial &&
        (input.source === IncidentSource.RACE_CONTROL ||
          input.source === IncidentSource.MARSHAL)
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only officials can file as race control or a marshal post.",
        });
      }

      if (input.reportedByRegistrationId) {
        const allowed = await canActForRegistration(
          ctx.db,
          input.reportedByRegistrationId,
          ctx.user.id,
        );
        if (!allowed) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "You cannot file a report on behalf of that entry.",
          });
        }
      }

      for (const registrationId of [
        input.subjectRegistrationId,
        input.reportedByRegistrationId,
      ]) {
        if (!registrationId) continue;
        const registration = await ctx.db.eventRegistration.findUnique({
          where: { id: registrationId },
          select: { eventId: true },
        });
        if (!registration || registration.eventId !== input.eventId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "That entry is not part of this event.",
          });
        }
      }

      const incident = await ctx.db.incident.create({
        data: { ...input, reportedById: ctx.user.id },
        include: incidentInclude,
      });

      // Officials need to know something landed in the queue.
      if (event.seriesId) {
        const officials = await ctx.db.seriesMembership.findMany({
          where: { seriesId: event.seriesId, role: { in: SERIES_PENALTY_ROLES } },
          select: { userId: true },
        });
        await Promise.all(
          officials
            .filter((official) => official.userId !== ctx.user.id)
            .map((official) =>
              notify(ctx.db, {
                userId: official.userId,
                type: NotificationType.SYSTEM,
                title:
                  input.source === IncidentSource.PROTEST
                    ? `Protest filed — ${event.name}`
                    : `Incident reported — ${event.name}`,
                body: input.summary,
                linkUrl: `/events/${event.id}/incidents`,
              }),
            ),
        );
      }
      return incident;
    }),

  /** Move a report through triage. Officials only. */
  setStatus: protectedProcedure
    .input(
      z.object({
        incidentId: z.string().cuid(),
        status: z.nativeEnum(IncidentStatus),
        decisionNotes: z.string().max(4000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const incident = await ctx.db.incident.findUnique({
        where: { id: input.incidentId },
        select: { id: true, eventId: true, status: true, reportedById: true },
      });
      if (!incident) throw new TRPCError({ code: "NOT_FOUND" });
      await assertOfficial(ctx.db, incident.eventId, ctx.user.id);

      if (!canTransitionIncident(incident.status, input.status)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cannot move a report from ${INCIDENT_STATUS_LABELS[incident.status]} to ${INCIDENT_STATUS_LABELS[input.status]}.`,
        });
      }

      const closing = !isIncidentOpen(input.status);
      const updated = await ctx.db.incident.update({
        where: { id: incident.id },
        data: {
          status: input.status,
          decisionNotes: input.decisionNotes,
          ...(closing
            ? { decidedById: ctx.user.id, decidedAt: new Date() }
            : {}),
        },
      });

      if (closing && incident.reportedById !== ctx.user.id) {
        await notify(ctx.db, {
          userId: incident.reportedById,
          type: NotificationType.SYSTEM,
          title: `Report closed — ${INCIDENT_STATUS_LABELS[input.status]}`,
          body: input.decisionNotes,
          linkUrl: `/events/${incident.eventId}/incidents`,
        });
      }
      return updated;
    }),

  /**
   * Close a report by issuing a penalty against the entry it names, linking
   * the two so the decision cites what prompted it.
   */
  issuePenalty: protectedProcedure
    .input(
      z.object({
        incidentId: z.string().cuid(),
        type: z.nativeEnum(PenaltyType),
        summary: z.string().min(3).max(300),
        details: z.string().max(4000).optional(),
        regulation: z.string().max(120).optional(),
        timeSeconds: z.number().int().min(0).max(3600).optional(),
        gridPlaces: z.number().int().min(0).max(60).optional(),
        pointsDeducted: z.number().int().min(0).max(1000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { incidentId, ...penaltyInput } = input;
      const incident = await ctx.db.incident.findUnique({
        where: { id: incidentId },
        select: {
          id: true,
          eventId: true,
          status: true,
          summary: true,
          lapNumber: true,
          subjectRegistrationId: true,
        },
      });
      if (!incident) throw new TRPCError({ code: "NOT_FOUND" });
      await assertOfficial(ctx.db, incident.eventId, ctx.user.id);

      if (!incident.subjectRegistrationId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "This report does not name an entry, so there is nobody to penalize.",
        });
      }
      if (!canIssuePenaltyFor(incident.status)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This report is already closed.",
        });
      }

      // The penalty and the status change land together: a penalty recorded
      // without closing its report would leave the queue permanently dirty.
      return ctx.db.$transaction(async (tx) => {
        const penalty = await tx.penalty.create({
          data: {
            ...penaltyInput,
            eventId: incident.eventId,
            registrationId: incident.subjectRegistrationId!,
            issuedById: ctx.user.id,
            lapNumber: incident.lapNumber,
            details:
              penaltyInput.details ??
              `Arising from incident report: ${incident.summary}`,
          },
        });
        await tx.incident.update({
          where: { id: incident.id },
          data: {
            status: IncidentStatus.PENALTY_ISSUED,
            penaltyId: penalty.id,
            decidedById: ctx.user.id,
            decidedAt: new Date(),
          },
        });
        return penalty;
      });
    }),

  /** Whoever filed a report can withdraw it while it is still open. */
  withdraw: protectedProcedure
    .input(z.object({ incidentId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const incident = await ctx.db.incident.findUnique({
        where: { id: input.incidentId },
        select: { id: true, reportedById: true, status: true },
      });
      if (!incident) throw new TRPCError({ code: "NOT_FOUND" });
      if (incident.reportedById !== ctx.user.id) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only whoever filed a report can withdraw it.",
        });
      }
      if (!isIncidentOpen(incident.status)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This report is already closed.",
        });
      }
      return ctx.db.incident.update({
        where: { id: incident.id },
        data: { status: IncidentStatus.WITHDRAWN },
      });
    }),

  /**
   * Reply on a report. The entry a protest names has a right of response, and
   * officials record their working here too.
   */
  respond: protectedProcedure
    .input(
      z.object({
        incidentId: z.string().cuid(),
        body: z.string().min(1).max(8000),
        /** Officials can keep a note internal. */
        visibleToCompetitors: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const incident = await ctx.db.incident.findUnique({
        where: { id: input.incidentId },
        select: {
          id: true,
          eventId: true,
          reportedById: true,
          subjectRegistrationId: true,
          event: { select: { seriesId: true } },
        },
      });
      if (!incident) throw new TRPCError({ code: "NOT_FOUND" });

      const role = incident.event.seriesId
        ? await getSeriesRole(ctx.db, incident.event.seriesId, ctx.user.id)
        : null;
      const isOfficial = Boolean(role && SERIES_PENALTY_ROLES.includes(role));

      const involved =
        incident.reportedById === ctx.user.id ||
        (incident.subjectRegistrationId !== null &&
          (await canActForRegistration(
            ctx.db,
            incident.subjectRegistrationId,
            ctx.user.id,
          )));

      if (!isOfficial && !involved) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only the parties involved and officials can reply.",
        });
      }
      if (!isOfficial && !input.visibleToCompetitors) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only officials can leave an internal note.",
        });
      }

      return ctx.db.incidentResponse.create({
        data: {
          incidentId: incident.id,
          authorId: ctx.user.id,
          body: input.body,
          visibleToCompetitors: input.visibleToCompetitors,
        },
      });
    }),

  /** Reports the signed-in user filed, across every event. */
  mine: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db.incident.findMany({
      where: { reportedById: ctx.user.id },
      orderBy: { createdAt: "desc" },
      include: {
        ...incidentInclude,
        event: { select: { id: true, name: true, date: true } },
      },
    });
  }),
});
