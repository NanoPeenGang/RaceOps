import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  ApplicationStatus,
  OpportunityStatus,
  OpportunityType,
  Prisma,
  TeamRole,
} from "@prisma/client";

const POSTING_ROLES: TeamRole[] = [TeamRole.OWNER, TeamRole.MANAGER];
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
      return ctx.db.application.create({
        data: {
          opportunityId: input.opportunityId,
          applicantId: ctx.user.id,
          coverNote: input.coverNote,
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
