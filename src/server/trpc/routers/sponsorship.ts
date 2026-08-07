import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { NotificationType, SponsorshipStatus } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { createTRPCRouter, protectedProcedure } from "@/server/trpc/trpc";
import {
  canTransitionSponsorship,
  SPONSORSHIP_STATUS_LABELS,
  summarizeSponsorships,
} from "@/lib/sponsorship";
import { TEAM_MANAGER_ROLES } from "@/lib/teams";
import { notify } from "@/server/services/notifications";
import { assertSponsorAccess } from "@/server/services/platform-admin";

/**
 * Sponsorship deals against a team.
 *
 * Two ways in: a sponsor proposes through the platform (`offer`), or a manager
 * records a deal agreed elsewhere (`create`). Either way the team drives the
 * status from there — accepting, negotiating, declining or retiring it.
 *
 * Commercial terms are not public. Every read here requires team membership.
 */

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
      message: "You must be a team owner or manager to manage sponsorships.",
    });
  }
}

/** Current roster membership — enough to read the commercial picture. */
async function assertTeamMember(
  db: PrismaClient,
  teamId: string,
  userId: string,
): Promise<void> {
  const membership = await db.teamMembership.findUnique({
    where: { teamId_userId: { teamId, userId } },
    select: { endDate: true },
  });
  if (!membership || membership.endDate !== null) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Sponsorship details are visible to the team only.",
    });
  }
}

/** Managers, for notifying a team that an offer landed. */
async function teamManagerIds(
  db: PrismaClient,
  teamId: string,
): Promise<string[]> {
  const memberships = await db.teamMembership.findMany({
    where: { teamId, endDate: null, role: { in: TEAM_MANAGER_ROLES } },
    select: { userId: true },
  });
  return memberships.map((m) => m.userId);
}

const dealFields = {
  sponsorName: z.string().min(2).max(160),
  contactEmail: z.string().email().max(200).optional(),
  websiteUrl: z.string().url().max(2000).optional(),
  logoUrl: z.string().url().max(2000).optional(),
  tier: z.string().max(80).optional(),
  /** Minor units (cents) so money never round-trips through a float. */
  valueMinor: z.number().int().min(0).max(2_000_000_000).optional(),
  currency: z.string().length(3).toUpperCase().default("USD"),
  season: z.string().max(40).optional(),
  startDate: z.date().optional(),
  endDate: z.date().optional(),
  notes: z.string().max(4000).optional(),
};

export const sponsorshipRouter = createTRPCRouter({
  /** Every deal on a team's books, with headline totals. Team-only. */
  forTeam: protectedProcedure
    .input(z.object({ teamId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      await assertTeamMember(ctx.db, input.teamId, ctx.user.id);
      const deals = await ctx.db.sponsorship.findMany({
        where: { teamId: input.teamId },
        orderBy: [{ status: "asc" }, { createdAt: "desc" }],
        include: {
          sponsorUser: {
            select: { id: true, profile: { select: { displayName: true } } },
          },
        },
      });
      return { deals, summary: summarizeSponsorships(deals) };
    }),

  /** Offers the signed-in sponsor has made, so they can track their own. */
  mine: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db.sponsorship.findMany({
      where: { sponsorUserId: ctx.user.id },
      orderBy: { createdAt: "desc" },
      include: { team: { select: { id: true, name: true, slug: true } } },
    });
  }),

  /**
   * A sponsor proposes a deal to a team.
   *
   * Approved sponsors only. This used to be open to anyone signed in, on the
   * theory that pitching is how a marketplace works — but an unsolicited offer
   * arrives in a manager's inbox carrying a company name, a link and money,
   * which is a spam vector with a notification attached. The application is
   * once; after that a sponsor pitches as many teams as they like.
   */
  offer: protectedProcedure
    .input(z.object({ teamId: z.string().cuid(), ...dealFields }))
    .mutation(async ({ ctx, input }) => {
      await assertSponsorAccess(ctx.db, ctx.user);
      const { teamId, ...fields } = input;
      const team = await ctx.db.team.findUnique({
        where: { id: teamId },
        select: { id: true, name: true },
      });
      if (!team) throw new TRPCError({ code: "NOT_FOUND" });

      if (fields.startDate && fields.endDate && fields.startDate > fields.endDate) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "A deal cannot end before it starts.",
        });
      }

      const deal = await ctx.db.sponsorship.create({
        data: {
          ...fields,
          teamId,
          sponsorUserId: ctx.user.id,
          createdById: ctx.user.id,
          status: SponsorshipStatus.OFFERED,
        },
      });

      const managers = await teamManagerIds(ctx.db, teamId);
      await Promise.all(
        managers
          .filter((id) => id !== ctx.user.id)
          .map((userId) =>
            notify(ctx.db, {
              userId,
              type: NotificationType.SYSTEM,
              title: `Sponsorship offer from ${fields.sponsorName}`,
              body: fields.notes?.slice(0, 300),
              linkUrl: `/teams/${team.id}/manage`,
            }),
          ),
      );
      return deal;
    }),

  /**
   * A manager records a deal directly — typically one already agreed offline,
   * so it can be created straight into ACTIVE.
   */
  create: protectedProcedure
    .input(
      z.object({
        teamId: z.string().cuid(),
        status: z
          .enum([
            SponsorshipStatus.OFFERED,
            SponsorshipStatus.NEGOTIATING,
            SponsorshipStatus.ACTIVE,
          ])
          .default(SponsorshipStatus.ACTIVE),
        ...dealFields,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { teamId, ...fields } = input;
      await assertTeamManager(ctx.db, teamId, ctx.user.id);
      if (fields.startDate && fields.endDate && fields.startDate > fields.endDate) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "A deal cannot end before it starts.",
        });
      }
      return ctx.db.sponsorship.create({
        data: { ...fields, teamId, createdById: ctx.user.id },
      });
    }),

  /** Move a deal along its lifecycle. Managers only. */
  setStatus: protectedProcedure
    .input(
      z.object({
        sponsorshipId: z.string().cuid(),
        status: z.nativeEnum(SponsorshipStatus),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const deal = await ctx.db.sponsorship.findUnique({
        where: { id: input.sponsorshipId },
        select: {
          id: true,
          teamId: true,
          status: true,
          sponsorName: true,
          sponsorUserId: true,
          team: { select: { name: true } },
        },
      });
      if (!deal) throw new TRPCError({ code: "NOT_FOUND" });
      await assertTeamManager(ctx.db, deal.teamId, ctx.user.id);

      if (!canTransitionSponsorship(deal.status, input.status)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cannot move a deal from ${SPONSORSHIP_STATUS_LABELS[deal.status]} to ${SPONSORSHIP_STATUS_LABELS[input.status]}.`,
        });
      }

      const updated = await ctx.db.sponsorship.update({
        where: { id: deal.id },
        data: {
          status: input.status,
          // Accepting a deal with no explicit start date starts it today.
          ...(input.status === SponsorshipStatus.ACTIVE
            ? { startDate: new Date() }
            : {}),
        },
      });

      // Tell a platform sponsor what happened to their pitch.
      if (deal.sponsorUserId && deal.sponsorUserId !== ctx.user.id) {
        await notify(ctx.db, {
          userId: deal.sponsorUserId,
          type: NotificationType.SYSTEM,
          title: `${deal.team.name}: offer ${SPONSORSHIP_STATUS_LABELS[input.status].toLowerCase()}`,
          linkUrl: `/teams`,
        });
      }
      return updated;
    }),

  update: protectedProcedure
    .input(
      z.object({
        sponsorshipId: z.string().cuid(),
        sponsorName: z.string().min(2).max(160).optional(),
        contactEmail: z.string().email().max(200).nullish(),
        websiteUrl: z.string().url().max(2000).nullish(),
        logoUrl: z.string().url().max(2000).nullish(),
        tier: z.string().max(80).nullish(),
        valueMinor: z.number().int().min(0).max(2_000_000_000).nullish(),
        currency: z.string().length(3).toUpperCase().optional(),
        season: z.string().max(40).nullish(),
        startDate: z.date().nullish(),
        endDate: z.date().nullish(),
        notes: z.string().max(4000).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { sponsorshipId, ...data } = input;
      const deal = await ctx.db.sponsorship.findUnique({
        where: { id: sponsorshipId },
        select: { teamId: true, startDate: true, endDate: true },
      });
      if (!deal) throw new TRPCError({ code: "NOT_FOUND" });
      await assertTeamManager(ctx.db, deal.teamId, ctx.user.id);

      const startDate =
        data.startDate === undefined ? deal.startDate : data.startDate;
      const endDate = data.endDate === undefined ? deal.endDate : data.endDate;
      if (startDate && endDate && startDate > endDate) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "A deal cannot end before it starts.",
        });
      }

      return ctx.db.sponsorship.update({
        where: { id: sponsorshipId },
        data,
      });
    }),

  remove: protectedProcedure
    .input(z.object({ sponsorshipId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const deal = await ctx.db.sponsorship.findUnique({
        where: { id: input.sponsorshipId },
        select: { teamId: true },
      });
      if (!deal) throw new TRPCError({ code: "NOT_FOUND" });
      await assertTeamManager(ctx.db, deal.teamId, ctx.user.id);
      await ctx.db.sponsorship.delete({ where: { id: input.sponsorshipId } });
      return { deleted: true };
    }),
});
