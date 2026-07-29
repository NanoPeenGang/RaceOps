import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { MediaVisibility, TeamRole } from "@prisma/client";
import {
  createTRPCRouter,
  protectedProcedure,
  publicProcedure,
} from "@/server/trpc/trpc";
import {
  assertEventOrganizer,
  assertSeriesRole,
  getSeriesRole,
  SERIES_EVENT_ROLES,
  SERIES_PENALTY_ROLES,
} from "@/server/services/series-auth";

/**
 * Media library. Items are registered by URL (upload to R2/S3/Cloudflare
 * Images, then attach the delivered URL here) and scoped to exactly one of a
 * series, event, team, penalty or appeal.
 *
 * Direct browser uploads land when object-storage credentials are configured;
 * the attach-by-URL path below works today and is what the UI uses.
 */

const TEAM_MEDIA_ROLES: TeamRole[] = [TeamRole.OWNER, TeamRole.MANAGER];

const scopeSchema = z
  .object({
    seriesId: z.string().cuid().optional(),
    eventId: z.string().cuid().optional(),
    teamId: z.string().cuid().optional(),
    penaltyId: z.string().cuid().optional(),
    appealId: z.string().cuid().optional(),
  })
  .refine(
    (scope) => Object.values(scope).filter(Boolean).length === 1,
    "Attach media to exactly one of a series, event, team, penalty or appeal.",
  );

type Scope = z.infer<typeof scopeSchema>;

/** Throws unless the caller may attach/remove media in the given scope. */
async function assertCanManageScope(
  ctx: { db: typeof import("@/server/db/client").db; user: { id: string } },
  scope: Scope,
): Promise<void> {
  if (scope.seriesId) {
    await assertSeriesRole(
      ctx.db,
      scope.seriesId,
      ctx.user.id,
      SERIES_EVENT_ROLES,
    );
    return;
  }
  if (scope.eventId) {
    await assertEventOrganizer(
      ctx.db,
      scope.eventId,
      ctx.user.id,
      SERIES_EVENT_ROLES,
    );
    return;
  }
  if (scope.teamId) {
    const membership = await ctx.db.teamMembership.findUnique({
      where: { teamId_userId: { teamId: scope.teamId, userId: ctx.user.id } },
    });
    if (
      !membership ||
      membership.endDate !== null ||
      !TEAM_MEDIA_ROLES.includes(membership.role)
    ) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Only team owners/managers can manage team media.",
      });
    }
    return;
  }
  if (scope.penaltyId) {
    // Evidence supporting a decision belongs to race control.
    const penalty = await ctx.db.penalty.findUnique({
      where: { id: scope.penaltyId },
      select: { eventId: true },
    });
    if (!penalty) throw new TRPCError({ code: "NOT_FOUND" });
    await assertEventOrganizer(
      ctx.db,
      penalty.eventId,
      ctx.user.id,
      SERIES_PENALTY_ROLES,
    );
    return;
  }
  if (scope.appealId) {
    // Evidence supporting an appeal belongs to whoever filed it.
    const appeal = await ctx.db.penaltyAppeal.findUnique({
      where: { id: scope.appealId },
      select: { filedById: true },
    });
    if (!appeal) throw new TRPCError({ code: "NOT_FOUND" });
    if (appeal.filedById !== ctx.user.id) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Only the competitor who filed the appeal can add evidence.",
      });
    }
    return;
  }
  throw new TRPCError({ code: "BAD_REQUEST", message: "No scope provided." });
}

export const mediaRouter = createTRPCRouter({
  /**
   * Public media for a scope. Organizer-only items are filtered out unless
   * the caller holds a role on the owning series.
   */
  forScope: publicProcedure
    .input(scopeSchema)
    .query(async ({ ctx, input }) => {
      let seriesId: string | null = input.seriesId ?? null;
      if (!seriesId && input.eventId) {
        const event = await ctx.db.raceEvent.findUnique({
          where: { id: input.eventId },
          select: { seriesId: true },
        });
        seriesId = event?.seriesId ?? null;
      }

      const localUser = ctx.clerkUserId
        ? await ctx.db.user.findUnique({
            where: { authProviderId: ctx.clerkUserId },
            select: { id: true },
          })
        : null;
      const role =
        localUser && seriesId
          ? await getSeriesRole(ctx.db, seriesId, localUser.id)
          : null;

      return ctx.db.media.findMany({
        where: {
          ...input,
          ...(role ? {} : { visibility: MediaVisibility.PUBLIC }),
        },
        orderBy: { createdAt: "desc" },
        include: {
          owner: {
            select: { id: true, profile: { select: { displayName: true } } },
          },
        },
      });
    }),

  attach: protectedProcedure
    .input(
      z.object({
        url: z.string().url().max(2000),
        kind: z.enum(["image", "video", "telemetry", "document"]),
        title: z.string().max(200).optional(),
        visibility: z.nativeEnum(MediaVisibility).default(MediaVisibility.PUBLIC),
        scope: scopeSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertCanManageScope(ctx, input.scope);
      return ctx.db.media.create({
        data: {
          ownerId: ctx.user.id,
          url: input.url,
          kind: input.kind,
          title: input.title,
          visibility: input.visibility,
          ...input.scope,
        },
      });
    }),

  remove: protectedProcedure
    .input(z.object({ mediaId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const media = await ctx.db.media.findUnique({
        where: { id: input.mediaId },
      });
      if (!media) throw new TRPCError({ code: "NOT_FOUND" });

      // The uploader can always remove their own item; otherwise the scope's
      // managers can.
      if (media.ownerId !== ctx.user.id) {
        await assertCanManageScope(ctx, {
          seriesId: media.seriesId ?? undefined,
          eventId: media.eventId ?? undefined,
          teamId: media.teamId ?? undefined,
          penaltyId: media.penaltyId ?? undefined,
          appealId: media.appealId ?? undefined,
        });
      }
      await ctx.db.media.delete({ where: { id: media.id } });
      return { deleted: true };
    }),
});
