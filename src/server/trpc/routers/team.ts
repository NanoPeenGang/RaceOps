import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  AccessRequestKind,
  RegistrationStatus,
  TeamRole,
} from "@prisma/client";
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
import { attentionForTeam } from "@/server/services/team-attention";
import {
  findSpendableApproval,
  spendApproval,
} from "@/server/services/platform-admin";
import type { TRPCContext } from "@/server/trpc/trpc";

const MANAGER_ROLES: TeamRole[] = TEAM_MANAGER_ROLES;

/**
 * Only an owner deletes a team.
 *
 * Narrower than the manager check used everywhere else on purpose: a manager
 * runs the team day to day, but ending it is the one act nobody can undo for
 * them.
 */
async function assertTeamOwner(
  db: TRPCContext["db"],
  teamId: string,
  userId: string,
) {
  const membership = await db.teamMembership.findUnique({
    where: { teamId_userId: { teamId, userId } },
    select: { role: true, endDate: true },
  });
  if (
    !membership ||
    membership.endDate !== null ||
    membership.role !== TeamRole.OWNER
  ) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only the team's owner can delete it.",
    });
  }
}

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
      // Approved first: a team page carries a roster, hiring and a public
      // name, which is exactly what spam wants. Platform staff bypass.
      const { requestId } = await findSpendableApproval(
        ctx.db,
        ctx.user,
        AccessRequestKind.TEAM,
      );

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

      // One transaction, so an approval can never be spent on a creation that
      // then failed — nor a team exist against an approval still marked open.
      return ctx.db.$transaction(async (tx) => {
        const team = await tx.team.create({
          data: {
            name: input.name,
            slug,
            description: input.description,
            roster: {
              create: { userId: ctx.user.id, role: TeamRole.OWNER },
            },
          },
        });
        await spendApproval(tx, requestId, team.id);
        return team;
      });
    }),

  update: protectedProcedure
    .input(
      z.object({
        teamId: z.string().cuid(),
        name: z.string().trim().min(2).max(120).optional(),
        description: z.string().max(2000).nullish(),
        logoUrl: z.string().url().nullish(),
        websiteUrl: z.string().url().nullish(),
        homeBase: z.string().max(120).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertTeamManager(ctx.db, input.teamId, ctx.user.id);
      const { teamId, ...data } = input;

      if (data.name) {
        // Team.name is unique, and the raw constraint error is unreadable.
        const clash = await ctx.db.team.findFirst({
          where: { name: data.name, id: { not: teamId } },
          select: { id: true },
        });
        if (clash) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Another team already races under that name.",
          });
        }
      }

      /*
       * The slug is left alone on rename, matching organizations. It is in
       * links people have already shared, in QR codes on printed passes and in
       * a browser history somebody is about to use — a rename should change
       * the name on the door, not break the address.
       */
      return ctx.db.team.update({ where: { id: teamId }, data });
    }),

  /**
   * What deleting a team would destroy.
   *
   * Shown before the button unlocks. A team is the busiest thing on this
   * platform — a roster, a garage, a hiring pipeline, a commercial record —
   * and the counts are the difference between an informed decision and a
   * regret. Owner-only, like the delete it precedes.
   */
  deletionImpact: protectedProcedure
    .input(z.object({ teamId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      await assertTeamOwner(ctx.db, input.teamId, ctx.user.id);
      const team = await ctx.db.team.findUnique({
        where: { id: input.teamId },
        select: { name: true },
      });
      if (!team) throw new TRPCError({ code: "NOT_FOUND" });

      const [
        roster,
        cars,
        inventory,
        invoices,
        payRuns,
        sponsorships,
        registrations,
        results,
        files,
        postings,
      ] = await Promise.all([
        ctx.db.teamMembership.count({ where: { teamId: input.teamId } }),
        ctx.db.car.count({ where: { teamId: input.teamId } }),
        ctx.db.inventoryItem.count({ where: { teamId: input.teamId } }),
        ctx.db.invoice.count({ where: { teamId: input.teamId } }),
        ctx.db.payRun.count({ where: { teamId: input.teamId } }),
        ctx.db.sponsorship.count({ where: { teamId: input.teamId } }),
        ctx.db.eventRegistration.count({ where: { teamId: input.teamId } }),
        // The count that reaches furthest: these sit in other people's
        // championships, and they go with the entry they hang off.
        ctx.db.eventResult.count({
          where: { registration: { teamId: input.teamId } },
        }),
        ctx.db.garageFile.count({ where: { teamId: input.teamId } }),
        ctx.db.opportunity.count({ where: { postedByTeamId: input.teamId } }),
      ]);

      return {
        name: team.name,
        roster,
        cars,
        inventory,
        invoices,
        payRuns,
        sponsorships,
        registrations,
        results,
        files,
        postings,
      };
    }),

  /**
   * Permanently delete a team and everything under it.
   *
   * Owner-only and guarded by retyping the name, matching series and events.
   *
   * The blast radius is wider than it looks, and the impact query says so
   * rather than leaving it to be discovered. Everything hanging off the team
   * cascades — roster, cars, garage, invoices, pay runs, chat — and so do the
   * team's **event entries, and the results attached to them**. Those live in
   * other organizers' events: deleting a team removes its cars from entry
   * lists it does not own and takes its finishes out of championships it did
   * not run.
   *
   * That is the existing behaviour of the schema rather than a decision taken
   * here, and it matches what deleting a series already does. It is called out
   * on the panel because an owner tidying up a defunct team will not otherwise
   * imagine that a championship somewhere else is about to change.
   *
   * Job postings are the exception: `Opportunity.postedByTeamId` is SET NULL,
   * so an application somebody sent survives with no team attached rather than
   * vanishing from their own history.
   */
  delete: protectedProcedure
    .input(
      z.object({
        teamId: z.string().cuid(),
        /// Retyped by the operator. Compared server-side, never trusted from
        /// the client's own idea of what the team is called.
        confirmName: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertTeamOwner(ctx.db, input.teamId, ctx.user.id);
      const team = await ctx.db.team.findUnique({
        where: { id: input.teamId },
        select: { id: true, name: true },
      });
      if (!team) throw new TRPCError({ code: "NOT_FOUND" });

      if (input.confirmName.trim() !== team.name) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "That is not the team's name. Nothing has been deleted.",
        });
      }

      await ctx.db.team.delete({ where: { id: team.id } });
      return { deleted: true, name: team.name };
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
        select: {
          id: true,
          userId: true,
          role: true,
          endDate: true,
          startDate: true,
        },
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
        where: {
          teamId_userId: { teamId: input.teamId, userId: input.userId },
        },
        data: { role: input.role },
      });
    }),

  /**
   * Take someone off the roster. The membership row is closed out rather than
   * deleted so past line-ups stay on the record.
   */
  removeMember: protectedProcedure
    .input(z.object({ teamId: z.string().cuid(), userId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertTeamManager(ctx.db, input.teamId, ctx.user.id);
      const roster = await ctx.db.teamMembership.findMany({
        where: { teamId: input.teamId },
        select: {
          id: true,
          userId: true,
          role: true,
          endDate: true,
          startDate: true,
        },
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

      /*
       * Null for everyone but a manager, rather than a zeroed shape. "Nothing
       * needs attention" and "you are not allowed to know" are different
       * answers, and returning the second as the first would quietly tell a
       * driver the team has no outstanding pay runs.
       */
      const attention = TEAM_MANAGER_ROLES.includes(membership.role)
        ? await attentionForTeam(ctx.db, team)
        : null;

      return {
        ...team,
        myRole: membership.role,
        myUserId: ctx.user.id,
        attention,
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
