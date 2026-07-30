import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  Prisma,
  ProfileType,
  RealWorldRole,
  SimRole,
  SubscriptionTier,
} from "@prisma/client";
import { createTRPCRouter, publicProcedure } from "@/server/trpc/trpc";
import { hasActiveTier } from "@/server/services/billing";

/**
 * Phase 1 discovery: filterable Postgres search over profiles.
 * Full-text search stays in Postgres until volume demands a dedicated engine;
 * Phase 5 adds Claude-powered natural-language query parsing in front of this.
 */
export const searchRouter = createTRPCRouter({
  profiles: publicProcedure
    .input(
      z.object({
        query: z.string().max(200).optional(),
        profileType: z.nativeEnum(ProfileType).optional(),
        /** Narrow to a specific job rather than the broad category. */
        simRole: z.nativeEnum(SimRole).optional(),
        realWorldRole: z.nativeEnum(RealWorldRole).optional(),
        location: z.string().max(120).optional(),
        verifiedOnly: z.boolean().default(false),
        cursor: z.string().cuid().optional(),
        limit: z.number().int().min(1).max(50).default(20),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Paid tier (spec Section 5): driver-side sponsor discovery is gated
      // behind the Sponsor Discovery subscription.
      if (input.profileType === ProfileType.SPONSOR) {
        const localUser = ctx.clerkUserId
          ? await ctx.db.user.findUnique({
              where: { authProviderId: ctx.clerkUserId },
              select: { id: true },
            })
          : null;
        const entitled = localUser
          ? await hasActiveTier(
              ctx.db,
              localUser.id,
              SubscriptionTier.SPONSOR_DISCOVERY,
            )
          : false;
        if (!entitled) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message:
              "Sponsor discovery requires the Sponsor Discovery subscription. Upgrade under Billing.",
          });
        }
      }

      // Every profile-scoped condition has to live under one `profile` key —
      // spreading several would silently overwrite all but the last.
      const profileWhere: Prisma.ProfileWhereInput = {
        ...(input.location
          ? { location: { contains: input.location, mode: "insensitive" } }
          : {}),
        ...(input.simRole ? { simRoles: { has: input.simRole } } : {}),
        ...(input.realWorldRole
          ? { realWorldRoles: { has: input.realWorldRole } }
          : {}),
      };

      const where: Prisma.UserWhereInput = {
        profile: { is: profileWhere },
        ...(input.profileType
          ? { profileTypes: { has: input.profileType } }
          : {}),
        ...(input.verifiedOnly ? { verificationStatus: "VERIFIED" } : {}),
        ...(input.query
          ? {
              OR: [
                {
                  profile: {
                    displayName: {
                      contains: input.query,
                      mode: "insensitive",
                    },
                  },
                },
                {
                  profile: {
                    bio: { contains: input.query, mode: "insensitive" },
                  },
                },
              ],
            }
          : {}),
      };

      const users = await ctx.db.user.findMany({
        where,
        take: input.limit + 1,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          profileTypes: true,
          verificationStatus: true,
          profile: {
            select: {
              displayName: true,
              bio: true,
              location: true,
              availability: true,
              simRoles: true,
              realWorldRoles: true,
            },
          },
        },
      });

      let nextCursor: string | undefined;
      if (users.length > input.limit) {
        nextCursor = users.pop()!.id;
      }
      return { users, nextCursor };
    }),
});
