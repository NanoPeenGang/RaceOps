import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { TeamRole } from "@prisma/client";
import {
  createTRPCRouter,
  protectedProcedure,
  publicProcedure,
} from "@/server/trpc/trpc";
import { slugify } from "@/lib/slug";
import type { TRPCContext } from "@/server/trpc/trpc";

const MANAGER_ROLES: TeamRole[] = [TeamRole.OWNER, TeamRole.MANAGER];

async function assertTeamManager(
  db: TRPCContext["db"],
  teamId: string,
  userId: string,
) {
  const membership = await db.teamMembership.findUnique({
    where: { teamId_userId: { teamId, userId } },
  });
  if (!membership || !MANAGER_ROLES.includes(membership.role)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You must be a team owner or manager to do that.",
    });
  }
  return membership;
}

export const teamRouter = createTRPCRouter({
  bySlug: publicProcedure
    .input(z.object({ slug: z.string().min(1).max(120) }))
    .query(async ({ ctx, input }) => {
      const team = await ctx.db.team.findUnique({
        where: { slug: input.slug },
        include: {
          roster: {
            where: { endDate: null },
            include: {
              user: {
                select: {
                  id: true,
                  profileTypes: true,
                  verificationStatus: true,
                  profile: { select: { displayName: true, location: true } },
                },
              },
            },
          },
          opportunities: { where: { status: "OPEN" } },
        },
      });
      if (!team) throw new TRPCError({ code: "NOT_FOUND" });
      return team;
    }),

  list: publicProcedure
    .input(
      z.object({
        cursor: z.string().cuid().optional(),
        limit: z.number().int().min(1).max(50).default(20),
      }),
    )
    .query(async ({ ctx, input }) => {
      const teams = await ctx.db.team.findMany({
        take: input.limit + 1,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
        orderBy: { createdAt: "desc" },
        include: { _count: { select: { roster: true } } },
      });
      let nextCursor: string | undefined;
      if (teams.length > input.limit) {
        nextCursor = teams.pop()!.id;
      }
      return { teams, nextCursor };
    }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(2).max(80),
        description: z.string().max(2000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const slug = slugify(input.name);
      const clash = await ctx.db.team.findFirst({
        where: { OR: [{ name: input.name }, { slug }] },
      });
      if (clash) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "A team with that name already exists.",
        });
      }
      return ctx.db.team.create({
        data: {
          name: input.name,
          slug,
          description: input.description,
          roster: {
            create: { userId: ctx.user.id, role: TeamRole.OWNER },
          },
        },
      });
    }),

  update: protectedProcedure
    .input(
      z.object({
        teamId: z.string().cuid(),
        description: z.string().max(2000).nullish(),
        logoUrl: z.string().url().nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertTeamManager(ctx.db, input.teamId, ctx.user.id);
      const { teamId, ...data } = input;
      return ctx.db.team.update({ where: { id: teamId }, data });
    }),

  join: protectedProcedure
    .input(z.object({ teamId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.teamMembership.findUnique({
        where: { teamId_userId: { teamId: input.teamId, userId: ctx.user.id } },
      });
      if (existing && existing.endDate === null) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Already a member of this team.",
        });
      }
      if (existing) {
        // Re-joining after a past stint: reactivate the membership row.
        return ctx.db.teamMembership.update({
          where: { id: existing.id },
          data: { endDate: null, startDate: new Date(), role: TeamRole.MEMBER },
        });
      }
      return ctx.db.teamMembership.create({
        data: { teamId: input.teamId, userId: ctx.user.id },
      });
    }),

  leave: protectedProcedure
    .input(z.object({ teamId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const membership = await ctx.db.teamMembership.findUnique({
        where: { teamId_userId: { teamId: input.teamId, userId: ctx.user.id } },
      });
      if (!membership || membership.endDate !== null) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      if (membership.role === TeamRole.OWNER) {
        const otherOwners = await ctx.db.teamMembership.count({
          where: {
            teamId: input.teamId,
            role: TeamRole.OWNER,
            endDate: null,
            NOT: { userId: ctx.user.id },
          },
        });
        if (otherOwners === 0) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Transfer ownership before leaving the team.",
          });
        }
      }
      return ctx.db.teamMembership.update({
        where: { id: membership.id },
        data: { endDate: new Date() },
      });
    }),

  setMemberRole: protectedProcedure
    .input(
      z.object({
        teamId: z.string().cuid(),
        userId: z.string().cuid(),
        role: z.nativeEnum(TeamRole),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertTeamManager(ctx.db, input.teamId, ctx.user.id);
      return ctx.db.teamMembership.update({
        where: { teamId_userId: { teamId: input.teamId, userId: input.userId } },
        data: { role: input.role },
      });
    }),
});
