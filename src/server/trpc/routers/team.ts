import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { RegistrationStatus, TeamRole } from "@prisma/client";
import {
  createTRPCRouter,
  protectedProcedure,
  publicProcedure,
} from "@/server/trpc/trpc";
import { slugify } from "@/lib/slug";
import { TEAM_MANAGER_ROLES, wouldOrphanTeam } from "@/lib/teams";
import { countActivePenalties, summarizeTeamSeries } from "@/lib/team-season";
import {
  computeSeriesStandings,
  selectTable,
} from "@/server/services/standings";
import type { TRPCContext } from "@/server/trpc/trpc";

const MANAGER_ROLES: TeamRole[] = TEAM_MANAGER_ROLES;

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
                  profile: {
                    select: {
                      displayName: true,
                      location: true,
                      simRoles: true,
                      realWorldRoles: true,
                    },
                  },
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

  /** Teams the caller can post/manage for (owner or manager). */
  myManagedTeams: protectedProcedure.query(async ({ ctx }) => {
    const memberships = await ctx.db.teamMembership.findMany({
      where: {
        userId: ctx.user.id,
        role: { in: MANAGER_ROLES },
        endDate: null,
      },
      include: { team: { select: { id: true, name: true } } },
    });
    return memberships.map((m) => m.team);
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
        websiteUrl: z.string().url().nullish(),
        homeBase: z.string().max(120).nullish(),
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
      const roster = await ctx.db.teamMembership.findMany({
        where: { teamId: input.teamId },
        select: { id: true, userId: true, role: true, endDate: true, startDate: true },
      });
      const target = roster.find((m) => m.userId === input.userId);
      if (!target) throw new TRPCError({ code: "NOT_FOUND" });

      // Demoting the last owner would leave nobody able to administer the team.
      if (
        target.role === TeamRole.OWNER &&
        input.role !== TeamRole.OWNER &&
        wouldOrphanTeam(roster, target.id)
      ) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Promote another owner before changing this one's role.",
        });
      }

      return ctx.db.teamMembership.update({
        where: { teamId_userId: { teamId: input.teamId, userId: input.userId } },
        data: { role: input.role },
      });
    }),

  /**
   * Take someone off the roster. The membership row is closed out rather than
   * deleted so past line-ups stay on the record.
   */
  removeMember: protectedProcedure
    .input(
      z.object({ teamId: z.string().cuid(), userId: z.string().cuid() }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertTeamManager(ctx.db, input.teamId, ctx.user.id);
      const roster = await ctx.db.teamMembership.findMany({
        where: { teamId: input.teamId },
        select: { id: true, userId: true, role: true, endDate: true, startDate: true },
      });
      const target = roster.find((m) => m.userId === input.userId);
      if (!target || target.endDate !== null) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      if (wouldOrphanTeam(roster, target.id)) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "A team must keep at least one owner.",
        });
      }
      return ctx.db.teamMembership.update({
        where: { id: target.id },
        data: { endDate: new Date() },
      });
    }),

  /** Teams the caller belongs to in any role, for their own navigation. */
  myTeams: protectedProcedure.query(async ({ ctx }) => {
    const memberships = await ctx.db.teamMembership.findMany({
      where: { userId: ctx.user.id, endDate: null },
      include: {
        team: {
          select: { id: true, name: true, slug: true, logoUrl: true },
        },
      },
      orderBy: { startDate: "asc" },
    });
    return memberships.map((m) => ({ ...m.team, myRole: m.role }));
  }),

  /**
   * Everything a team needs to run itself: roster, entries, calendar and the
   * caller's own role. Member-only — entry notes and contact details are not
   * public.
   */
  dashboard: protectedProcedure
    .input(z.object({ teamId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      const membership = await ctx.db.teamMembership.findUnique({
        where: {
          teamId_userId: { teamId: input.teamId, userId: ctx.user.id },
        },
        select: { role: true, endDate: true },
      });
      if (!membership || membership.endDate !== null) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only current team members can open the team console.",
        });
      }

      const team = await ctx.db.team.findUnique({
        where: { id: input.teamId },
        include: {
          roster: {
            include: {
              user: {
                select: {
                  id: true,
                  verificationStatus: true,
                  profile: {
                    select: {
                      displayName: true,
                      location: true,
                      simRoles: true,
                      realWorldRoles: true,
                    },
                  },
                },
              },
            },
          },
          registrations: {
            orderBy: { event: { date: "asc" } },
            include: {
              event: {
                select: {
                  id: true,
                  name: true,
                  date: true,
                  endDate: true,
                  venue: true,
                  platform: true,
                  status: true,
                  series: { select: { id: true, name: true, slug: true } },
                },
              },
              result: true,
              penalties: {
                select: { id: true, status: true, type: true, summary: true },
              },
            },
          },
          _count: { select: { sponsorships: true } },
        },
      });
      if (!team) throw new TRPCError({ code: "NOT_FOUND" });

      return {
        ...team,
        myRole: membership.role,
        myUserId: ctx.user.id,
      };
    }),

  /**
   * Championship position and per-event results for every series the team
   * races in. Public — a team's competition record is part of its reputation.
   */
  season: publicProcedure
    .input(z.object({ teamId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      const registrations = await ctx.db.eventRegistration.findMany({
        where: { teamId: input.teamId, status: RegistrationStatus.CONFIRMED },
        include: {
          event: {
            select: {
              id: true,
              name: true,
              date: true,
              seriesId: true,
              seriesLabel: true,
              series: { select: { id: true, name: true, slug: true } },
            },
          },
          result: true,
          penalties: { select: { status: true } },
        },
      });

      const results = registrations.map((registration) => ({
        eventId: registration.event.id,
        eventName: registration.event.name,
        eventDate: registration.event.date,
        seriesId: registration.event.seriesId,
        seriesName:
          registration.event.series?.name ?? registration.event.seriesLabel,
        registrationId: registration.id,
        carNumber: registration.carNumber,
        carClass: registration.carClass,
        finishPosition: registration.result?.finishPosition ?? null,
        status: registration.result?.status ?? null,
        fastestLap: registration.result?.fastestLap ?? false,
        activePenalties: countActivePenalties(registration.penalties),
      }));

      // One standings table per distinct managed series the team appears in.
      const seriesSeen = new Map<
        string,
        { id: string; name: string; slug: string }
      >();
      for (const registration of registrations) {
        const series = registration.event.series;
        if (series && !seriesSeen.has(series.id)) {
          seriesSeen.set(series.id, series);
        }
      }

      const summaries = [];
      for (const series of seriesSeen.values()) {
        const standings = await computeSeriesStandings(ctx.db, series.id);
        if (!standings) continue;
        // The team's own position comes from the teams' championship table.
        const table = selectTable(standings, "team");
        if (!table) continue;
        summaries.push(summarizeTeamSeries(series, table.rows, input.teamId));
      }

      return { results, summaries };
    }),
});
