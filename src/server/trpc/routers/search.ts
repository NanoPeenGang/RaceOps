import { z } from "zod";
import { Prisma, ProfileType } from "@prisma/client";
import { createTRPCRouter, publicProcedure } from "@/server/trpc/trpc";

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
        location: z.string().max(120).optional(),
        verifiedOnly: z.boolean().default(false),
        cursor: z.string().cuid().optional(),
        limit: z.number().int().min(1).max(50).default(20),
      }),
    )
    .query(async ({ ctx, input }) => {
      const where: Prisma.UserWhereInput = {
        profile: { isNot: null },
        ...(input.profileType
          ? { profileTypes: { has: input.profileType } }
          : {}),
        ...(input.verifiedOnly ? { verificationStatus: "VERIFIED" } : {}),
        ...(input.location
          ? {
              profile: {
                location: { contains: input.location, mode: "insensitive" },
              },
            }
          : {}),
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
