import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  ApplicationStatus,
  NotificationType,
  OpportunityStatus,
  OpportunityType,
  Prisma,
  SubscriptionTier,
  TeamRole,
} from "@prisma/client";
import { isEntitledTo } from "@/server/services/billing";
import { notify } from "@/server/services/notifications";
import {
  canTeamTransition,
  TEAM_SETTABLE_STATUSES,
} from "@/lib/hiring";
import type { TRPCContext } from "@/server/trpc/trpc";

const POSTING_ROLES: TeamRole[] = [TeamRole.OWNER, TeamRole.MANAGER];

/** True when the user posted the opportunity, or manages the posting team. */
async function isPosterFor(
  ctx: TRPCContext,
  opportunity: { postedByUserId: string | null; postedByTeamId: string | null },
  userId: string,
): Promise<boolean> {
  if (opportunity.postedByUserId === userId) return true;
  if (!opportunity.postedByTeamId) return false;
  const membership = await ctx.db.teamMembership.findUnique({
    where: {
      teamId_userId: { teamId: opportunity.postedByTeamId, userId },
    },
  });
  return (
    !!membership &&
    membership.endDate === null &&
    POSTING_ROLES.includes(membership.role)
  );
}
import {
  createTRPCRouter,
  protectedProcedure,
  publicProcedure,
} from "@/server/trpc/trpc";

export const opportunityRouter = createTRPCRouter({
  list: publicProcedure
    .input(
      z.object({
        type: z.nativeEnum(OpportunityType).optional(),
        location: z.string().max(120).optional(),
        series: z.string().max(120).optional(),
        cursor: z.string().cuid().optional(),
        limit: z.number().int().min(1).max(50).default(20),
      }),
    )
    .query(async ({ ctx, input }) => {
      const items = await ctx.db.opportunity.findMany({
        where: {
          status: OpportunityStatus.OPEN,
          ...(input.type ? { type: input.type } : {}),
          ...(input.location
            ? { location: { contains: input.location, mode: "insensitive" } }
            : {}),
          ...(input.series
            ? { series: { contains: input.series, mode: "insensitive" } }
            : {}),
        },
        take: input.limit + 1,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
        orderBy: { createdAt: "desc" },
        include: {
          postedByTeam: { select: { id: true, name: true, slug: true, logoUrl: true } },
        },
      });
      let nextCursor: string | undefined;
      if (items.length > input.limit) {
        nextCursor = items.pop()!.id;
      }
      return { items, nextCursor };
    }),

  byId: publicProcedure
    .input(z.object({ id: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      const opportunity = await ctx.db.opportunity.findUnique({
        where: { id: input.id },
        include: {
          postedByTeam: { select: { id: true, name: true, slug: true } },
          _count: { select: { applications: true } },
        },
      });
      if (!opportunity) throw new TRPCError({ code: "NOT_FOUND" });
      return opportunity;
    }),

  create: protectedProcedure
    .input(
      z.object({
        type: z.nativeEnum(OpportunityType),
        title: z.string().min(4).max(140),
        description: z.string().min(10).max(10_000),
        requirements: z.record(z.string(), z.unknown()).optional(),
        compensation: z.string().max(300).optional(),
        location: z.string().max(120).optional(),
        series: z.string().max(120).optional(),
        teamId: z.string().cuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { teamId, ...data } = input;
      if (teamId) {
        const membership = await ctx.db.teamMembership.findUnique({
          where: { teamId_userId: { teamId, userId: ctx.user.id } },
        });
        const canPost =
          membership &&
          membership.endDate === null &&
          POSTING_ROLES.includes(membership.role);
        if (!canPost) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Only team owners/managers can post for a team.",
          });
        }
        // Paid tier (spec Section 5): team listings require the recruiter tier.
        const entitled = await isEntitledTo(
          ctx.db,
          ctx.user.id,
          SubscriptionTier.RECRUITER,
        );
        if (!entitled) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message:
              "Posting team listings requires an active Recruiter subscription. Upgrade under Billing.",
          });
        }
      }
      return ctx.db.opportunity.create({
        data: {
          ...data,
          requirements:
            (data.requirements as Prisma.InputJsonValue | undefined) ??
            undefined,
          postedByTeamId: teamId,
          postedByUserId: teamId ? undefined : ctx.user.id,
        },
      });
    }),

  close: protectedProcedure
    .input(z.object({ id: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const opportunity = await ctx.db.opportunity.findUnique({
        where: { id: input.id },
        select: { postedByUserId: true, postedByTeamId: true },
      });
      if (!opportunity) throw new TRPCError({ code: "NOT_FOUND" });

      let authorized = opportunity.postedByUserId === ctx.user.id;
      if (!authorized && opportunity.postedByTeamId) {
        const membership = await ctx.db.teamMembership.findUnique({
          where: {
            teamId_userId: {
              teamId: opportunity.postedByTeamId,
              userId: ctx.user.id,
            },
          },
        });
        authorized =
          !!membership &&
          membership.endDate === null &&
          POSTING_ROLES.includes(membership.role);
      }
      if (!authorized) throw new TRPCError({ code: "FORBIDDEN" });

      return ctx.db.opportunity.update({
        where: { id: input.id },
        data: { status: OpportunityStatus.CLOSED },
      });
    }),

  // "apply" is a reserved word in tRPC router keys (Function.prototype.apply)
  submitApplication: protectedProcedure
    .input(
      z.object({
        opportunityId: z.string().cuid(),
        coverNote: z.string().max(4000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const opportunity = await ctx.db.opportunity.findUnique({
        where: { id: input.opportunityId },
        select: { status: true },
      });
      if (!opportunity) throw new TRPCError({ code: "NOT_FOUND" });
      if (opportunity.status !== OpportunityStatus.OPEN) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "This opportunity is no longer open.",
        });
      }
      const existing = await ctx.db.application.findUnique({
        where: {
          opportunityId_applicantId: {
            opportunityId: input.opportunityId,
            applicantId: ctx.user.id,
          },
        },
      });
      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "You have already applied.",
        });
      }
      const application = await ctx.db.application.create({
        data: {
          opportunityId: input.opportunityId,
          applicantId: ctx.user.id,
          coverNote: input.coverNote,
        },
        include: {
          opportunity: {
            select: {
              title: true,
              postedByUserId: true,
              postedByTeamId: true,
            },
          },
        },
      });

      // Notify whoever reviews this listing: the individual poster, or the
      // posting team's active owners/managers.
      const recipientIds = new Set<string>();
      if (application.opportunity.postedByUserId) {
        recipientIds.add(application.opportunity.postedByUserId);
      } else if (application.opportunity.postedByTeamId) {
        const managers = await ctx.db.teamMembership.findMany({
          where: {
            teamId: application.opportunity.postedByTeamId,
            role: { in: POSTING_ROLES },
            endDate: null,
          },
          select: { userId: true },
        });
        for (const manager of managers) recipientIds.add(manager.userId);
      }
      recipientIds.delete(ctx.user.id);
      await Promise.all(
        [...recipientIds].map((userId) =>
          notify(ctx.db, {
            userId,
            type: NotificationType.APPLICATION_RECEIVED,
            title: `New application: ${application.opportunity.title}`,
            body: input.coverNote,
            linkUrl: "/opportunities/mine",
          }),
        ),
      );

      return application;
    }),

  /** Applications for a listing — poster/manager only. */
  applicationsFor: protectedProcedure
    .input(z.object({ opportunityId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      const opportunity = await ctx.db.opportunity.findUnique({
        where: { id: input.opportunityId },
        select: { postedByUserId: true, postedByTeamId: true },
      });
      if (!opportunity) throw new TRPCError({ code: "NOT_FOUND" });
      if (!(await isPosterFor(ctx, opportunity, ctx.user.id))) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      return ctx.db.application.findMany({
        where: { opportunityId: input.opportunityId },
        orderBy: { createdAt: "desc" },
        include: {
          applicant: {
            select: {
              id: true,
              profileTypes: true,
              verificationStatus: true,
              profile: { select: { displayName: true, location: true } },
            },
          },
        },
      });
    }),

  /** Poster moves an application through review; applicant is notified. */
  setApplicationStatus: protectedProcedure
    .input(
      z.object({
        applicationId: z.string().cuid(),
        status: z.enum(
          TEAM_SETTABLE_STATUSES.map((s) => s.toString()) as [
            string,
            ...string[],
          ],
        ),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const application = await ctx.db.application.findUnique({
        where: { id: input.applicationId },
        include: {
          opportunity: {
            select: {
              title: true,
              postedByUserId: true,
              postedByTeamId: true,
            },
          },
        },
      });
      if (!application) throw new TRPCError({ code: "NOT_FOUND" });
      if (!(await isPosterFor(ctx, application.opportunity, ctx.user.id))) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const nextStatus = input.status as ApplicationStatus;
      if (!canTeamTransition(application.status, nextStatus)) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Cannot move an application from ${application.status} to ${nextStatus}.`,
        });
      }
      const updated = await ctx.db.application.update({
        where: { id: application.id },
        data: { status: nextStatus },
      });
      await notify(ctx.db, {
        userId: application.applicantId,
        type: NotificationType.APPLICATION_STATUS_CHANGED,
        title: `Your application for "${application.opportunity.title}" is now ${nextStatus.toLowerCase()}`,
        linkUrl: "/applications",
      });
      return updated;
    }),

  /** Listings the caller posted (directly or via teams they manage). */
  myPostings: protectedProcedure.query(async ({ ctx }) => {
    const managedTeams = await ctx.db.teamMembership.findMany({
      where: { userId: ctx.user.id, role: { in: POSTING_ROLES }, endDate: null },
      select: { teamId: true },
    });
    return ctx.db.opportunity.findMany({
      where: {
        OR: [
          { postedByUserId: ctx.user.id },
          { postedByTeamId: { in: managedTeams.map((m) => m.teamId) } },
        ],
      },
      orderBy: { createdAt: "desc" },
      include: {
        postedByTeam: { select: { name: true } },
        _count: { select: { applications: true } },
      },
    });
  }),

  myApplications: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db.application.findMany({
      where: { applicantId: ctx.user.id },
      orderBy: { createdAt: "desc" },
      include: {
        opportunity: {
          select: { id: true, title: true, type: true, status: true },
        },
      },
    });
  }),

  withdrawApplication: protectedProcedure
    .input(z.object({ applicationId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.db.application.updateMany({
        where: { id: input.applicationId, applicantId: ctx.user.id },
        data: { status: ApplicationStatus.WITHDRAWN },
      });
      if (result.count === 0) throw new TRPCError({ code: "NOT_FOUND" });
      return { withdrawn: true };
    }),
});
