import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  ApplicationStatus,
  InterviewKind,
  InterviewStatus,
  NotificationType,
  OfferStatus,
  OpportunityStatus,
  PayBasis,
  TeamRole,
} from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { createTRPCRouter, protectedProcedure } from "@/server/trpc/trpc";
import { TEAM_MANAGER_ROLES } from "@/lib/teams";
import { buildPipeline, inboxCounts, isClosed } from "@/lib/hiring";
import { MAX_SLOTS, checkSlots } from "@/lib/interviews";
import { checkOffer, describePay, hasExpired } from "@/lib/offers";
import { notify } from "@/server/services/notifications";

/**
 * Hiring: the applications inbox, interviews and offers.
 *
 * The point of pulling this out of the opportunity router is that a team does
 * not think in postings — it thinks in *people waiting on an answer*. So the
 * inbox is team-scoped and spans every opportunity the team has open, and the
 * pipeline is the shape of the page rather than a filter on a list.
 *
 * Hiring is a manager's job throughout. It is the one area where the whole
 * roster deliberately does not get write access: pay, terms and rejection
 * letters are not things a team wants any member able to send.
 */

/** Throws unless the caller manages the team. */
async function assertTeamManager(
  db: PrismaClient,
  teamId: string,
  userId: string,
): Promise<void> {
  const membership = await db.teamMembership.findUnique({
    where: { teamId_userId: { teamId, userId } },
    select: { role: true, endDate: true },
  });
  if (
    !membership ||
    membership.endDate !== null ||
    !TEAM_MANAGER_ROLES.includes(membership.role)
  ) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Hiring is for the team's owner and managers.",
    });
  }
}

/**
 * Loads an application and checks the caller hires for the team behind it.
 *
 * Returns the team id as well, because every mutation downstream needs it and
 * re-deriving it from the opportunity at each call site is how one of them
 * ends up checking the wrong team.
 */
async function assertHiringFor(
  db: PrismaClient,
  applicationId: string,
  userId: string,
): Promise<{ teamId: string; applicantId: string; status: ApplicationStatus }> {
  const application = await db.application.findUnique({
    where: { id: applicationId },
    select: {
      applicantId: true,
      status: true,
      opportunity: { select: { postedByTeamId: true } },
    },
  });
  if (!application) throw new TRPCError({ code: "NOT_FOUND" });

  const teamId = application.opportunity.postedByTeamId;
  if (!teamId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "That posting belongs to an individual rather than a team, so it has no hiring inbox.",
    });
  }
  await assertTeamManager(db, teamId, userId);
  return { teamId, applicantId: application.applicantId, status: application.status };
}

/** Throws unless the caller is the applicant. */
async function assertApplicant(
  db: PrismaClient,
  applicationId: string,
  userId: string,
): Promise<void> {
  const application = await db.application.findUnique({
    where: { id: applicationId },
    select: { applicantId: true },
  });
  if (!application) throw new TRPCError({ code: "NOT_FOUND" });
  if (application.applicantId !== userId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "That is not your application.",
    });
  }
}

/**
 * Moves an application forward, but never backwards.
 *
 * Called when an interview is proposed or an offer sent. Guarded rather than
 * assigned outright: sending a second interview to somebody who already has an
 * offer out must not drag them back a stage, and an application somebody has
 * already been rejected from must not silently reopen.
 */
async function advanceTo(
  db: PrismaClient,
  applicationId: string,
  status: ApplicationStatus,
): Promise<void> {
  const application = await db.application.findUnique({
    where: { id: applicationId },
    select: { status: true },
  });
  if (!application || isClosed(application.status)) return;

  const order: ApplicationStatus[] = [
    ApplicationStatus.SUBMITTED,
    ApplicationStatus.REVIEWING,
    ApplicationStatus.INTERVIEWING,
    ApplicationStatus.OFFERED,
  ];
  if (order.indexOf(status) <= order.indexOf(application.status)) return;

  await db.application.update({
    where: { id: applicationId },
    data: { status },
  });
}

const APPLICANT_SUMMARY = {
  id: true,
  profile: {
    select: {
      displayName: true,
      avatarUrl: true,
      location: true,
      bio: true,
      simRoles: true,
      realWorldRoles: true,
    },
  },
} as const;

export const hiringRouter = createTRPCRouter({
  /**
   * Every application to every posting a team has, as a pipeline.
   *
   * One query rather than one per posting: the question is "who is waiting on
   * us", and it does not care which advert they came through.
   */
  inbox: protectedProcedure
    .input(
      z.object({
        teamId: z.string().cuid(),
        includeClosed: z.boolean().default(false),
      }),
    )
    .query(async ({ ctx, input }) => {
      await assertTeamManager(ctx.db, input.teamId, ctx.user.id);

      const applications = await ctx.db.application.findMany({
        where: {
          opportunity: { postedByTeamId: input.teamId },
          ...(input.includeClosed
            ? {}
            : {
                status: {
                  notIn: [
                    ApplicationStatus.REJECTED,
                    ApplicationStatus.WITHDRAWN,
                    ApplicationStatus.OFFER_DECLINED,
                  ],
                },
              }),
        },
        orderBy: { createdAt: "asc" },
        include: {
          applicant: { select: APPLICANT_SUMMARY },
          opportunity: {
            select: { id: true, title: true, type: true, status: true },
          },
          interviews: {
            orderBy: { createdAt: "desc" },
            include: { slots: { orderBy: { startsAt: "asc" } } },
          },
          offers: { orderBy: { createdAt: "desc" } },
        },
      });

      const postings = await ctx.db.opportunity.findMany({
        where: { postedByTeamId: input.teamId },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          title: true,
          type: true,
          status: true,
          _count: { select: { applications: true } },
        },
      });

      return {
        pipeline: buildPipeline(applications),
        closed: applications.filter((application) =>
          isClosed(application.status),
        ),
        counts: inboxCounts(applications),
        postings,
      };
    }),

  /** One application in full, for the detail panel. */
  application: protectedProcedure
    .input(z.object({ applicationId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      await assertHiringFor(ctx.db, input.applicationId, ctx.user.id);
      return ctx.db.application.findUniqueOrThrow({
        where: { id: input.applicationId },
        include: {
          applicant: { select: APPLICANT_SUMMARY },
          opportunity: true,
          interviews: {
            orderBy: { createdAt: "desc" },
            include: { slots: { orderBy: { startsAt: "asc" } } },
          },
          offers: { orderBy: { createdAt: "desc" } },
        },
      });
    }),

  // -- Interviews ----------------------------------------------------------

  /**
   * Proposes an interview at one or more times.
   *
   * Several times at once is the whole feature. One suggested slot turns into
   * an email thread; three turns into one round trip.
   */
  proposeInterview: protectedProcedure
    .input(
      z.object({
        applicationId: z.string().cuid(),
        kind: z.nativeEnum(InterviewKind).default(InterviewKind.VIDEO_CALL),
        slots: z.array(z.date()).min(1).max(MAX_SLOTS),
        durationMinutes: z.number().int().min(5).max(600).default(30),
        location: z.string().max(500).nullish(),
        agenda: z.string().max(4000).nullish(),
        privateNotes: z.string().max(4000).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { applicantId } = await assertHiringFor(
        ctx.db,
        input.applicationId,
        ctx.user.id,
      );

      const problem = checkSlots(input.slots);
      if (problem) {
        throw new TRPCError({ code: "BAD_REQUEST", message: problem.message });
      }

      const interview = await ctx.db.interview.create({
        data: {
          applicationId: input.applicationId,
          kind: input.kind,
          durationMinutes: input.durationMinutes,
          location: input.location ?? null,
          agenda: input.agenda ?? null,
          privateNotes: input.privateNotes ?? null,
          createdById: ctx.user.id,
          slots: { create: input.slots.map((startsAt) => ({ startsAt })) },
        },
        include: { slots: true },
      });

      await advanceTo(
        ctx.db,
        input.applicationId,
        ApplicationStatus.INTERVIEWING,
      );
      await notifyApplicant(ctx.db, applicantId, {
        title: "You have been invited to an interview",
        body: `Pick a time that works — ${input.slots.length} were offered.`,
        linkUrl: "/applications",
      });

      return interview;
    }),

  /** The applicant picks a slot, or says none of them work. */
  respondToInterview: protectedProcedure
    .input(
      z.object({
        interviewId: z.string().cuid(),
        /// Null declines the lot.
        slotId: z.string().cuid().nullable(),
        note: z.string().max(1000).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const interview = await ctx.db.interview.findUnique({
        where: { id: input.interviewId },
        include: { slots: true, application: { select: { id: true } } },
      });
      if (!interview) throw new TRPCError({ code: "NOT_FOUND" });
      await assertApplicant(ctx.db, interview.applicationId, ctx.user.id);

      if (interview.status !== InterviewStatus.PROPOSED) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "That interview has already been answered.",
        });
      }

      if (input.slotId === null) {
        return ctx.db.interview.update({
          where: { id: interview.id },
          data: {
            status: InterviewStatus.DECLINED,
            responseNote: input.note ?? null,
          },
        });
      }

      const slot = interview.slots.find((row) => row.id === input.slotId);
      if (!slot) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "That time is not one of the ones offered.",
        });
      }
      if (slot.startsAt.getTime() <= Date.now()) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "That time has passed. Ask them to propose new ones.",
        });
      }

      return ctx.db.$transaction(async (tx) => {
        await tx.interviewSlot.update({
          where: { id: slot.id },
          data: { chosen: true },
        });
        return tx.interview.update({
          where: { id: interview.id },
          data: {
            status: InterviewStatus.CONFIRMED,
            scheduledAt: slot.startsAt,
            responseNote: input.note ?? null,
          },
          include: { slots: true },
        });
      });
    }),

  /** Records how an interview went, or calls it off. Team side. */
  updateInterview: protectedProcedure
    .input(
      z.object({
        interviewId: z.string().cuid(),
        status: z
          .enum([InterviewStatus.COMPLETED, InterviewStatus.CANCELED])
          .optional(),
        location: z.string().max(500).nullish(),
        agenda: z.string().max(4000).nullish(),
        privateNotes: z.string().max(4000).nullish(),
        outcome: z.string().max(4000).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { interviewId, ...data } = input;
      const interview = await ctx.db.interview.findUnique({
        where: { id: interviewId },
        select: { applicationId: true },
      });
      if (!interview) throw new TRPCError({ code: "NOT_FOUND" });
      await assertHiringFor(ctx.db, interview.applicationId, ctx.user.id);

      return ctx.db.interview.update({ where: { id: interviewId }, data });
    }),

  // -- Offers --------------------------------------------------------------

  createOffer: protectedProcedure
    .input(
      z.object({
        applicationId: z.string().cuid(),
        role: z.nativeEnum(TeamRole).default(TeamRole.MEMBER),
        title: z.string().max(120).nullish(),
        basis: z.nativeEnum(PayBasis).default(PayBasis.UNPAID),
        amountMinor: z.number().int().min(0).max(1_000_000_000).nullish(),
        currency: z.string().length(3).default("USD"),
        extras: z.string().max(4000).nullish(),
        startDate: z.date().nullish(),
        endDate: z.date().nullish(),
        scope: z.string().max(500).nullish(),
        terms: z.string().max(8000).nullish(),
        expiresAt: z.date().nullish(),
        /// Send it straight away rather than saving a draft first.
        send: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { teamId, applicantId } = await assertHiringFor(
        ctx.db,
        input.applicationId,
        ctx.user.id,
      );

      const problems = checkOffer(input);
      if (problems.length > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: problems.map((problem) => problem.message).join(" "),
        });
      }

      const { send, ...terms } = input;
      const offer = await ctx.db.offer.create({
        data: {
          ...terms,
          teamId,
          createdById: ctx.user.id,
          status: send ? OfferStatus.SENT : OfferStatus.DRAFT,
          sentAt: send ? new Date() : null,
        },
      });

      if (send) {
        await advanceTo(
          ctx.db,
          input.applicationId,
          ApplicationStatus.OFFERED,
        );
        await notifyApplicant(ctx.db, applicantId, {
          title: "You have an offer",
          body: describePay(offer),
          linkUrl: "/applications",
        });
      }
      return offer;
    }),

  /** Sends a draft, or re-sends one that was withdrawn. */
  sendOffer: protectedProcedure
    .input(z.object({ offerId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const offer = await ctx.db.offer.findUnique({
        where: { id: input.offerId },
      });
      if (!offer) throw new TRPCError({ code: "NOT_FOUND" });
      const { applicantId } = await assertHiringFor(
        ctx.db,
        offer.applicationId,
        ctx.user.id,
      );

      if (offer.status !== OfferStatus.DRAFT) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "That offer has already gone out.",
        });
      }
      const problems = checkOffer(offer);
      if (problems.length > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: problems.map((problem) => problem.message).join(" "),
        });
      }

      const sent = await ctx.db.offer.update({
        where: { id: offer.id },
        data: { status: OfferStatus.SENT, sentAt: new Date() },
      });
      await advanceTo(ctx.db, offer.applicationId, ApplicationStatus.OFFERED);
      await notifyApplicant(ctx.db, applicantId, {
        title: "You have an offer",
        body: describePay(sent),
        linkUrl: "/applications",
      });
      return sent;
    }),

  /** Pulls an offer back before it is answered. */
  withdrawOffer: protectedProcedure
    .input(z.object({ offerId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const offer = await ctx.db.offer.findUnique({
        where: { id: input.offerId },
      });
      if (!offer) throw new TRPCError({ code: "NOT_FOUND" });
      await assertHiringFor(ctx.db, offer.applicationId, ctx.user.id);

      if (offer.status === OfferStatus.ACCEPTED) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "That offer was accepted. Take the person off the roster instead — withdrawing it now would erase an agreement they acted on.",
        });
      }

      return ctx.db.offer.update({
        where: { id: offer.id },
        data: { status: OfferStatus.WITHDRAWN, withdrawnAt: new Date() },
      });
    }),

  /**
   * The applicant answers.
   *
   * Accepting is what puts them on the roster, at the role the offer named,
   * and sets their standing pay rate from its terms. That single step is the
   * reason the offer is a record rather than a message: hiring somebody and
   * then separately typing them into the roster and again into the pay rates
   * is where the details drift apart.
   */
  respondToOffer: protectedProcedure
    .input(
      z.object({
        offerId: z.string().cuid(),
        accept: z.boolean(),
        note: z.string().max(2000).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const offer = await ctx.db.offer.findUnique({
        where: { id: input.offerId },
        include: { application: { select: { id: true, applicantId: true } } },
      });
      if (!offer) throw new TRPCError({ code: "NOT_FOUND" });
      await assertApplicant(ctx.db, offer.applicationId, ctx.user.id);

      if (offer.status !== OfferStatus.SENT) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            offer.status === OfferStatus.DRAFT
              ? "That offer has not been sent."
              : "That offer has already been answered.",
        });
      }
      if (hasExpired(offer)) {
        // Marked rather than silently accepted: an expiry the team set is a
        // term of the offer, not a display detail.
        await ctx.db.offer.update({
          where: { id: offer.id },
          data: { status: OfferStatus.EXPIRED },
        });
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "That offer has expired. Ask the team to send a new one.",
        });
      }

      const now = new Date();
      const result = await ctx.db.$transaction(async (tx) => {
        const answered = await tx.offer.update({
          where: { id: offer.id },
          data: {
            status: input.accept ? OfferStatus.ACCEPTED : OfferStatus.DECLINED,
            respondedAt: now,
            responseNote: input.note ?? null,
          },
        });

        await tx.application.update({
          where: { id: offer.applicationId },
          data: {
            status: input.accept
              ? ApplicationStatus.ACCEPTED
              : ApplicationStatus.OFFER_DECLINED,
          },
        });

        if (!input.accept) return answered;

        // On the roster, at the role the offer named. `upsert` because
        // somebody rejoining a team they were on before already has a
        // membership row with an end date on it.
        await tx.teamMembership.upsert({
          where: {
            teamId_userId: {
              teamId: offer.teamId,
              userId: ctx.user.id,
            },
          },
          create: {
            teamId: offer.teamId,
            userId: ctx.user.id,
            role: offer.role,
            startDate: offer.startDate ?? now,
          },
          update: {
            role: offer.role,
            endDate: null,
            startDate: offer.startDate ?? now,
          },
        });

        // And their standing rate, so the first pay run does not start with
        // somebody retyping terms that are already written down.
        if (offer.basis !== PayBasis.UNPAID) {
          await tx.payRate.create({
            data: {
              teamId: offer.teamId,
              userId: ctx.user.id,
              basis: offer.basis,
              amountMinor: offer.amountMinor,
              currency: offer.currency,
              label: offer.title,
              effectiveFrom: offer.startDate ?? now,
              notes: "Set from the accepted offer.",
              createdById: ctx.user.id,
            },
          });
        }

        return answered;
      });

      await notifyTeamManagers(ctx.db, offer.teamId, {
        title: input.accept ? "Offer accepted" : "Offer declined",
        body: input.note ?? undefined,
        linkUrl: `/teams`,
      });

      return result;
    }),

  // -- Applicant side ------------------------------------------------------

  /** Everything the caller has applied for, with what is waiting on them. */
  myApplications: protectedProcedure.query(async ({ ctx }) => {
    const applications = await ctx.db.application.findMany({
      where: { applicantId: ctx.user.id },
      orderBy: { createdAt: "desc" },
      include: {
        opportunity: {
          select: {
            id: true,
            title: true,
            type: true,
            status: true,
            postedByTeam: { select: { id: true, name: true, slug: true } },
          },
        },
        interviews: {
          orderBy: { createdAt: "desc" },
          include: { slots: { orderBy: { startsAt: "asc" } } },
        },
        // Drafts are the team's private working copy; an applicant seeing one
        // would be reading terms nobody has decided to make them.
        offers: {
          where: { status: { not: OfferStatus.DRAFT } },
          orderBy: { createdAt: "desc" },
        },
      },
    });
    return { applications };
  }),

  /**
   * Closes a posting once somebody is hired.
   *
   * Offered rather than automatic: a team hiring two mechanics off one advert
   * would be furious to find it closed after the first, and there is no way
   * for the platform to know how many seats a posting is for.
   */
  closePosting: protectedProcedure
    .input(z.object({ opportunityId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const opportunity = await ctx.db.opportunity.findUnique({
        where: { id: input.opportunityId },
        select: { postedByTeamId: true },
      });
      if (!opportunity?.postedByTeamId) throw new TRPCError({ code: "NOT_FOUND" });
      await assertTeamManager(
        ctx.db,
        opportunity.postedByTeamId,
        ctx.user.id,
      );

      return ctx.db.opportunity.update({
        where: { id: input.opportunityId },
        data: { status: OpportunityStatus.CLOSED },
      });
    }),
});

/** Best-effort: a notification that fails must not lose the decision. */
async function notifyApplicant(
  db: PrismaClient,
  userId: string,
  message: { title: string; body?: string; linkUrl?: string },
): Promise<void> {
  await Promise.allSettled([
    notify(db, {
      userId,
      type: NotificationType.APPLICATION_STATUS_CHANGED,
      ...message,
    }),
  ]);
}

async function notifyTeamManagers(
  db: PrismaClient,
  teamId: string,
  message: { title: string; body?: string; linkUrl?: string },
): Promise<void> {
  const managers = await db.teamMembership.findMany({
    where: { teamId, endDate: null, role: { in: [...TEAM_MANAGER_ROLES] } },
    select: { userId: true },
  });
  await Promise.allSettled(
    managers.map((manager) =>
      notify(db, {
        userId: manager.userId,
        type: NotificationType.APPLICATION_STATUS_CHANGED,
        ...message,
      }),
    ),
  );
}
