import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  AccessRequestKind,
  AccessRequestStatus,
  NotificationType,
  OrgRole,
  PlatformRole,
} from "@prisma/client";
import { createTRPCRouter, protectedProcedure } from "@/server/trpc/trpc";
import {
  ACCESS_KIND_LABELS,
  canApplyFor,
  canDecide,
  canWithdraw,
  checkRequest,
  needsSubject,
  sortQueue,
} from "@/lib/access-requests";
import {
  assertCanGrantRoles,
  assertCanReview,
  canReview,
  demotionProblem,
  effectivePlatformRole,
  hasBootstrapAdmin,
  isPlatformOwner,
} from "@/server/services/platform-admin";
import { notify } from "@/server/services/notifications";
import { TEAM_MANAGER_ROLES } from "@/lib/teams";
import type { TRPCContext } from "@/server/trpc/trpc";

/** Who can commit an organization to something on its behalf. */
const ORG_APPLY_ROLES: OrgRole[] = [OrgRole.OWNER, OrgRole.ADMIN];

/**
 * Applications to publish on the platform, and the queue that reviews them.
 *
 * Anyone can sign up, keep a profile, drive, crew and apply for seats without
 * ever coming here. This is only for the things that put a name in front of
 * everybody else — a team, an organization, a championship, a sponsor account,
 * or permission for a team to advertise seats and jobs — which are the
 * surfaces spam actually uses.
 *
 * Most kinds are granted to the person who asks. Recruiting is granted to the
 * *team*, so a manager who applies and then leaves does not take the team's
 * ability to hire with them.
 */

const STAFF_SUMMARY = {
  id: true,
  email: true,
  platformRole: true,
  profile: { select: { displayName: true } },
} as const;

const REQUESTER_SUMMARY = {
  id: true,
  email: true,
  createdAt: true,
  verificationStatus: true,
  profile: {
    select: { displayName: true, location: true, bio: true, avatarUrl: true },
  },
} as const;

export const accessRouter = createTRPCRouter({
  /** What the caller has applied for, and what they may still apply for. */
  mine: protectedProcedure.query(async ({ ctx }) => {
    const requests = await ctx.db.accessRequest.findMany({
      where: { requestedById: ctx.user.id },
      orderBy: { createdAt: "desc" },
      include: {
        reviewedBy: { select: { profile: { select: { displayName: true } } } },
        subjectTeam: { select: { id: true, name: true, slug: true } },
        subjectOrganization: { select: { id: true, name: true, slug: true } },
      },
    });

    const role = effectivePlatformRole(ctx.user);
    return {
      requests,
      // Platform staff never need to apply, so the form says so rather than
      // offering them a queue they would be approving themselves in.
      isStaff: canReview(role),
      platformRole: role,
      canApply: Object.fromEntries(
        Object.values(AccessRequestKind).map((kind) => [
          kind,
          canApplyFor(kind, requests),
        ]),
      ) as Record<AccessRequestKind, boolean>,
    };
  }),

  submit: protectedProcedure
    .input(
      z.object({
        kind: z.nativeEnum(AccessRequestKind),
        proposedName: z.string().min(1).max(120),
        summary: z.string().min(1).max(4000),
        websiteUrl: z.string().url().max(2000).nullish(),
        experience: z.string().max(4000).nullish(),
        /// Which team or organization the request is for. RECRUITING only.
        subjectTeamId: z.string().cuid().nullish(),
        subjectOrganizationId: z.string().cuid().nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const problem = checkRequest(input);
      if (problem) {
        throw new TRPCError({ code: "BAD_REQUEST", message: problem.message });
      }

      const subject = await resolveSubject(ctx.db, ctx.user.id, input);

      const existing = await ctx.db.accessRequest.findMany({
        where: {
          requestedById: ctx.user.id,
          // A subject-scoped kind is only blocked by a pending request for the
          // *same* body — applying for a second team is a separate ask, not a
          // duplicate of the first.
          ...(subject.subjectTeamId || subject.subjectOrganizationId
            ? {
                OR: [
                  { subjectTeamId: subject.subjectTeamId ?? undefined },
                  {
                    subjectOrganizationId:
                      subject.subjectOrganizationId ?? undefined,
                  },
                ],
              }
            : {}),
        },
        select: { kind: true, status: true, fulfilledEntityId: true },
      });
      if (!canApplyFor(input.kind, existing)) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `You already have a ${ACCESS_KIND_LABELS[
            input.kind
          ].toLowerCase()} application waiting on review.`,
        });
      }

      if (subject.alreadyApproved) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `${subject.name} is already approved for this.`,
        });
      }

      const created = await ctx.db.accessRequest.create({
        data: {
          kind: input.kind,
          requestedById: ctx.user.id,
          proposedName: input.proposedName.trim(),
          summary: input.summary.trim(),
          websiteUrl: input.websiteUrl ?? null,
          experience: input.experience ?? null,
          subjectTeamId: subject.subjectTeamId,
          subjectOrganizationId: subject.subjectOrganizationId,
        },
      });

      await notifyReviewers(ctx.db, {
        title: `New ${ACCESS_KIND_LABELS[input.kind].toLowerCase()} application`,
        body: created.proposedName,
        linkUrl: "/admin/access",
      });
      return created;
    }),

  withdraw: protectedProcedure
    .input(z.object({ requestId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const request = await ctx.db.accessRequest.findUnique({
        where: { id: input.requestId },
        select: { requestedById: true, status: true },
      });
      if (!request) throw new TRPCError({ code: "NOT_FOUND" });
      if (request.requestedById !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      if (!canWithdraw(request.status)) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "That application has already been decided.",
        });
      }

      return ctx.db.accessRequest.update({
        where: { id: input.requestId },
        data: { status: AccessRequestStatus.WITHDRAWN },
      });
    }),

  // -- Review queue --------------------------------------------------------

  /** The queue, oldest pending first. Moderators and admins only. */
  queue: protectedProcedure
    .input(
      z.object({
        status: z.nativeEnum(AccessRequestStatus).optional(),
        kind: z.nativeEnum(AccessRequestKind).optional(),
        limit: z.number().int().min(1).max(200).default(100),
      }),
    )
    .query(async ({ ctx, input }) => {
      const role = assertCanReview(ctx.user);

      const requests = await ctx.db.accessRequest.findMany({
        where: {
          ...(input.status ? { status: input.status } : {}),
          ...(input.kind ? { kind: input.kind } : {}),
        },
        orderBy: { createdAt: "asc" },
        take: input.limit,
        include: {
          requestedBy: { select: REQUESTER_SUMMARY },
          reviewedBy: {
            select: { profile: { select: { displayName: true } } },
          },
          // Which body the request is for. A reviewer deciding a recruiting
          // application without knowing whose team it is has nothing to go on.
          subjectTeam: { select: { id: true, name: true, slug: true } },
          subjectOrganization: { select: { id: true, name: true, slug: true } },
        },
      });

      const pending = await ctx.db.accessRequest.groupBy({
        by: ["kind"],
        where: { status: AccessRequestStatus.PENDING },
        _count: { _all: true },
      });

      return {
        requests: sortQueue(requests),
        platformRole: role,
        pendingByKind: Object.fromEntries(
          pending.map((row) => [row.kind, row._count._all]),
        ) as Partial<Record<AccessRequestKind, number>>,
        pendingTotal: pending.reduce((sum, row) => sum + row._count._all, 0),
      };
    }),

  decide: protectedProcedure
    .input(
      z.object({
        requestId: z.string().cuid(),
        approve: z.boolean(),
        note: z.string().max(2000).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertCanReview(ctx.user);

      const request = await ctx.db.accessRequest.findUnique({
        where: { id: input.requestId },
        select: {
          status: true,
          kind: true,
          requestedById: true,
          proposedName: true,
        },
      });
      if (!request) throw new TRPCError({ code: "NOT_FOUND" });
      if (!canDecide(request.status)) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "That application has already been decided.",
        });
      }

      /*
       * A rejection has to say why. "No" with no reason is what makes people
       * re-apply blind, which fills the queue with the same application three
       * times — the opposite of what a review queue is for.
       */
      if (!input.approve && !input.note?.trim()) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Say why, so they know whether it is worth applying again.",
        });
      }

      const decided = await ctx.db.accessRequest.update({
        where: { id: input.requestId },
        data: {
          status: input.approve
            ? AccessRequestStatus.APPROVED
            : AccessRequestStatus.REJECTED,
          reviewedById: ctx.user.id,
          reviewedAt: new Date(),
          decisionNote: input.note?.trim() ?? null,
        },
      });

      const label = ACCESS_KIND_LABELS[request.kind].toLowerCase();
      await notifyOne(ctx.db, request.requestedById, {
        title: input.approve
          ? `Your ${label} application was approved`
          : `Your ${label} application was declined`,
        body: input.approve
          ? `You can now create "${request.proposedName}".`
          : (input.note ?? undefined),
        linkUrl: "/apply",
      });

      return decided;
    }),

  // -- Platform roles ------------------------------------------------------

  /** Who can review, and whether the deployment has a bootstrap admin. */
  staff: protectedProcedure
    .input(
      z
        .object({
          /*
           * Appointing the first moderator needs a way to reach somebody who
           * is not staff yet. Searched rather than listed: the user table is
           * everybody who has ever signed up, and a picker over it would be
           * both slow and a directory of every member's email address.
           */
          query: z.string().trim().min(3).max(200).optional(),
        })
        .default({}),
    )
    .query(async ({ ctx, input }) => {
      assertCanReview(ctx.user);
      const staff = await ctx.db.user.findMany({
        where: { platformRole: { not: PlatformRole.MEMBER } },
        select: STAFF_SUMMARY,
        orderBy: { email: "asc" },
      });

      // Exact address only. A substring search would let a moderator enumerate
      // the membership by typing "a", which is not what this control is for.
      const matches = input.query
        ? await ctx.db.user.findMany({
            where: { email: { equals: input.query, mode: "insensitive" } },
            select: STAFF_SUMMARY,
            take: 5,
          })
        : [];

      return {
        staff,
        matches,
        // So the panel can mark the owner's row and drop its control rather
        // than offering a demotion the server will refuse.
        ownerEmails: [...staff, ...matches]
          .filter((person) => isPlatformOwner(person.email))
          .map((person) => person.email),
        // Surfaced so a deployment with no configured admin and no admin rows
        // finds out before the queue silently stops being reviewed.
        hasBootstrapAdmin: hasBootstrapAdmin(),
        canGrantRoles: effectivePlatformRole(ctx.user) === PlatformRole.ADMIN,
      };
    }),

  setPlatformRole: protectedProcedure
    .input(
      z.object({
        userId: z.string().cuid(),
        role: z.nativeEnum(PlatformRole),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertCanGrantRoles(ctx.user);

      const target = await ctx.db.user.findUnique({
        where: { id: input.userId },
        select: { id: true, email: true },
      });
      if (!target) throw new TRPCError({ code: "NOT_FOUND" });

      /*
       * Two ways a demotion leaves nobody able to review: demoting the owner,
       * and the last admin demoting themselves on a deployment with no way
       * back in. Both are refused rather than warned about — a queue nobody
       * can open does not announce itself, it just stops being answered.
       */
      if (input.role !== PlatformRole.ADMIN) {
        const otherAdmins = await ctx.db.user.count({
          where: {
            platformRole: PlatformRole.ADMIN,
            id: { not: target.id },
          },
        });
        const problem = demotionProblem({
          isOwner: isPlatformOwner(target.email),
          isSelf: target.id === ctx.user.id,
          otherAdmins,
          hasBootstrap: hasBootstrapAdmin(),
        });
        if (problem) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: problem,
          });
        }
      }

      return ctx.db.user.update({
        where: { id: input.userId },
        data: { platformRole: input.role },
        select: { id: true, email: true, platformRole: true },
      });
    }),
});

/**
 * Works out which body a request is for, and whether the caller may speak for
 * it.
 *
 * The authorization is the point. Without it anybody could apply on behalf of
 * a team they have nothing to do with, and an approving admin would have no
 * way of telling — the application would look identical to a real one.
 */
async function resolveSubject(
  db: TRPCContext["db"],
  userId: string,
  input: {
    kind: AccessRequestKind;
    subjectTeamId?: string | null;
    subjectOrganizationId?: string | null;
  },
): Promise<{
  subjectTeamId: string | null;
  subjectOrganizationId: string | null;
  name: string;
  alreadyApproved: boolean;
}> {
  if (!needsSubject(input.kind)) {
    // Silently dropped rather than rejected: the other kinds create the thing
    // they are about, so a stray id is a client bug, not a user's mistake.
    return {
      subjectTeamId: null,
      subjectOrganizationId: null,
      name: "",
      alreadyApproved: false,
    };
  }

  const bothOrNeither =
    Boolean(input.subjectTeamId) === Boolean(input.subjectOrganizationId);
  if (bothOrNeither) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Say which team or organization this is for.",
    });
  }

  if (input.subjectTeamId) {
    const membership = await db.teamMembership.findUnique({
      where: {
        teamId_userId: { teamId: input.subjectTeamId, userId },
      },
      select: { role: true, endDate: true, team: { select: { name: true } } },
    });
    if (
      !membership ||
      membership.endDate !== null ||
      !TEAM_MANAGER_ROLES.includes(membership.role)
    ) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Only a team's owner or managers can apply on its behalf.",
      });
    }
    const approved = await db.accessRequest.findFirst({
      where: {
        kind: input.kind,
        status: AccessRequestStatus.APPROVED,
        subjectTeamId: input.subjectTeamId,
      },
      select: { id: true },
    });
    return {
      subjectTeamId: input.subjectTeamId,
      subjectOrganizationId: null,
      name: membership.team.name,
      alreadyApproved: approved !== null,
    };
  }

  const organizationId = input.subjectOrganizationId!;
  const staff = await db.organizationMembership.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
    select: {
      role: true,
      organization: { select: { name: true } },
    },
  });
  if (!staff || !ORG_APPLY_ROLES.includes(staff.role)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "Only an organization's owners or admins can apply on its behalf.",
    });
  }
  const approved = await db.accessRequest.findFirst({
    where: {
      kind: input.kind,
      status: AccessRequestStatus.APPROVED,
      subjectOrganizationId: organizationId,
    },
    select: { id: true },
  });
  return {
    subjectTeamId: null,
    subjectOrganizationId: organizationId,
    name: staff.organization.name,
    alreadyApproved: approved !== null,
  };
}

/** Best-effort: a failed notification must not lose the application. */
async function notifyOne(
  db: Parameters<typeof notify>[0],
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

async function notifyReviewers(
  db: Parameters<typeof notify>[0],
  message: { title: string; body?: string; linkUrl?: string },
): Promise<void> {
  const reviewers = await db.user.findMany({
    where: { platformRole: { not: PlatformRole.MEMBER } },
    select: { id: true },
  });
  await Promise.allSettled(
    reviewers.map((reviewer) =>
      notify(db, {
        userId: reviewer.id,
        type: NotificationType.SYSTEM,
        ...message,
      }),
    ),
  );
}
