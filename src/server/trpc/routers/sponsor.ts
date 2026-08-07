import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { NotificationType, SponsorshipStatus } from "@prisma/client";
import { createTRPCRouter, protectedProcedure } from "@/server/trpc/trpc";
import {
  assertSponsorAccess,
  hasSponsorAccess,
} from "@/server/services/platform-admin";
import {
  isStaleOffer,
  isUpForRenewal,
  sortSponsorDeals,
  summarizeSponsorPortfolio,
} from "@/lib/sponsor-dashboard";
import { TEAM_MANAGER_ROLES } from "@/lib/teams";
import { notify } from "@/server/services/notifications";

/**
 * The sponsor's own console.
 *
 * A sponsor's deals already live in `sponsorshipRouter`, but every read there
 * is scoped to one team and gated on team membership — correct for a manager,
 * useless for a backer with deals across six teams who wants one page. This
 * router reads the same rows the other way round: by sponsor, across teams.
 *
 * Every procedure is scoped to `ctx.user.id` as the sponsor. There is no
 * "look at another sponsor's book" here, and commercial terms stay between the
 * two parties exactly as they do on the team side.
 */

const TEAM_CARD = {
  id: true,
  name: true,
  slug: true,
  logoUrl: true,
  homeBase: true,
} as const;

export const sponsorRouter = createTRPCRouter({
  /**
   * Whether the caller may act as a sponsor.
   *
   * Deliberately not gated: the dashboard page calls this to decide between
   * showing the console and pointing at the application form, and throwing
   * FORBIDDEN at somebody who has not applied yet would turn "you need to
   * apply" into an error screen.
   */
  access: protectedProcedure.query(async ({ ctx }) => {
    return { approved: await hasSponsorAccess(ctx.db, ctx.user) };
  }),

  /** Everything a sponsor has on the go, across every team. */
  dashboard: protectedProcedure.query(async ({ ctx }) => {
    await assertSponsorAccess(ctx.db, ctx.user);

    const deals = await ctx.db.sponsorship.findMany({
      where: { sponsorUserId: ctx.user.id },
      orderBy: { createdAt: "desc" },
      include: { team: { select: TEAM_CARD } },
    });

    const now = new Date();
    return {
      deals: sortSponsorDeals(deals),
      totals: summarizeSponsorPortfolio(deals),
      // Two nudges, both derived rather than stored, so they cannot go stale:
      // offers nobody has answered, and live deals about to lapse.
      stale: deals.filter((deal) => isStaleOffer(deal, now)).map((d) => d.id),
      renewing: deals
        .filter((deal) => isUpForRenewal(deal, now))
        .map((d) => d.id),
    };
  }),

  /**
   * Teams a sponsor could approach.
   *
   * Teams already in the book are marked rather than hidden — a sponsor
   * renewing with a team they backed last season is the common case, and
   * hiding them would make the platform look like it had lost the team.
   */
  discoverTeams: protectedProcedure
    .input(
      z.object({
        query: z.string().max(120).optional(),
        limit: z.number().int().min(1).max(50).default(24),
        cursor: z.string().cuid().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      await assertSponsorAccess(ctx.db, ctx.user);

      const search = input.query?.trim();
      const teams = await ctx.db.team.findMany({
        where: search
          ? {
              OR: [
                { name: { contains: search, mode: "insensitive" } },
                { homeBase: { contains: search, mode: "insensitive" } },
                { description: { contains: search, mode: "insensitive" } },
              ],
            }
          : {},
        orderBy: { name: "asc" },
        take: input.limit + 1,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
        select: {
          ...TEAM_CARD,
          description: true,
          _count: { select: { roster: true } },
        },
      });

      const page = teams.slice(0, input.limit);
      const nextCursor =
        teams.length > input.limit ? teams[input.limit - 1]!.id : null;

      /*
       * One query for the caller's existing deals across the whole page rather
       * than one per team — the loop version was the shape that made the
       * message inbox slow, and a discovery grid is the exact place it would
       * come back.
       */
      const existing = page.length
        ? await ctx.db.sponsorship.findMany({
            where: {
              sponsorUserId: ctx.user.id,
              teamId: { in: page.map((team) => team.id) },
            },
            select: { teamId: true, status: true },
          })
        : [];

      const byTeam = new Map<string, SponsorshipStatus[]>();
      for (const deal of existing) {
        byTeam.set(deal.teamId, [...(byTeam.get(deal.teamId) ?? []), deal.status]);
      }

      return {
        teams: page.map((team) => ({
          ...team,
          existingStatuses: byTeam.get(team.id) ?? [],
        })),
        nextCursor,
      };
    }),

  /**
   * Pull an offer the team has not answered.
   *
   * Only from OFFERED. Once a team has opened negotiations there is a
   * conversation in progress, and letting one side delete it unilaterally
   * would lose the other side's context — that is a decline, which the team
   * records, not a withdrawal.
   */
  withdrawOffer: protectedProcedure
    .input(
      z.object({
        sponsorshipId: z.string().cuid(),
        reason: z.string().max(2000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const deal = await ctx.db.sponsorship.findUnique({
        where: { id: input.sponsorshipId },
        select: {
          id: true,
          status: true,
          sponsorUserId: true,
          sponsorName: true,
          teamId: true,
          notes: true,
        },
      });
      if (!deal) throw new TRPCError({ code: "NOT_FOUND" });
      if (deal.sponsorUserId !== ctx.user.id) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "That offer is not yours to withdraw.",
        });
      }
      if (deal.status !== SponsorshipStatus.OFFERED) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "The team has already picked this up — talk to them rather than withdrawing it.",
        });
      }

      const reason = input.reason?.trim();
      const updated = await ctx.db.sponsorship.update({
        where: { id: deal.id },
        data: {
          status: SponsorshipStatus.DECLINED,
          // Appended, not replaced: the team may have been reading these terms
          // when it arrived, and overwriting them would erase what was offered.
          notes: reason
            ? [deal.notes, `Withdrawn by the sponsor: ${reason}`]
                .filter(Boolean)
                .join("\n\n")
            : deal.notes,
        },
      });

      const managers = await ctx.db.teamMembership.findMany({
        where: {
          teamId: deal.teamId,
          endDate: null,
          role: { in: TEAM_MANAGER_ROLES },
        },
        select: { userId: true },
      });
      await Promise.allSettled(
        managers.map(({ userId }) =>
          notify(ctx.db, {
            userId,
            type: NotificationType.SYSTEM,
            title: `${deal.sponsorName} withdrew their sponsorship offer`,
            body: reason,
            linkUrl: `/teams/${deal.teamId}/manage`,
          }),
        ),
      );

      return updated;
    }),
});
