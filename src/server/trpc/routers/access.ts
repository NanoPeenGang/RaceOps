import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  AccessRequestKind,
  AccessRequestStatus,
  NotificationType,
  PlatformRole,
} from "@prisma/client";
import { createTRPCRouter, protectedProcedure } from "@/server/trpc/trpc";
import {
  ACCESS_KIND_LABELS,
  canApplyFor,
  canDecide,
  canWithdraw,
  checkRequest,
  sortQueue,
} from "@/lib/access-requests";
import {
  assertCanGrantRoles,
  assertCanReview,
  canReview,
  effectivePlatformRole,
  hasBootstrapAdmin,
} from "@/server/services/platform-admin";
import { notify } from "@/server/services/notifications";

/**
 * Applications to publish on the platform, and the queue that reviews them.
 *
 * Anyone can sign up, keep a profile, drive, crew and apply for seats without
 * ever coming here. This is only for the four things that put a name in front
 * of everybody else — a team, an organization, a championship, a sponsor
 * account — which are the surfaces spam actually uses.
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
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const problem = checkRequest(input);
      if (problem) {
        throw new TRPCError({ code: "BAD_REQUEST", message: problem.message });
      }

      const existing = await ctx.db.accessRequest.findMany({
        where: { requestedById: ctx.user.id },
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

      const created = await ctx.db.accessRequest.create({
        data: {
          kind: input.kind,
          requestedById: ctx.user.id,
          proposedName: input.proposedName.trim(),
          summary: input.summary.trim(),
          websiteUrl: input.websiteUrl ?? null,
          experience: input.experience ?? null,
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

      /*
       * Demoting yourself is allowed only while somebody else can still
       * review. The environment list is a way back in, but a deployment that
       * has not set one would be left with a queue nobody can open.
       */
      if (input.userId === ctx.user.id && input.role !== PlatformRole.ADMIN) {
        const otherAdmins = await ctx.db.user.count({
          where: {
            platformRole: PlatformRole.ADMIN,
            id: { not: ctx.user.id },
          },
        });
        if (otherAdmins === 0 && !hasBootstrapAdmin()) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "You are the only platform admin and PLATFORM_ADMIN_EMAILS is not set — promote somebody else first, or nobody can review applications.",
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
