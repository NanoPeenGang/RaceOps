import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  createTRPCRouter,
  protectedProcedure,
  publicProcedure,
} from "@/server/trpc/trpc";

/** Manual sim-stats entry (Phase 1). API auto-sync replaces this in Phase 3. */
const simStatsSchema = z.record(
  z.string().min(1).max(40),
  z.object({
    iRating: z.number().int().min(0).max(20000).optional(),
    safetyRating: z.string().max(20).optional(),
    licenseClass: z.string().max(20).optional(),
    notes: z.string().max(500).optional(),
  }),
);

export const profileRouter = createTRPCRouter({
  /** Public profile page by user id. */
  byUserId: publicProcedure
    .input(z.object({ userId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      const profile = await ctx.db.profile.findUnique({
        where: { userId: input.userId },
        include: {
          realWorldCredentials: true,
          industryExperience: true,
          user: {
            select: {
              id: true,
              profileTypes: true,
              verificationStatus: true,
              endorsementsReceived: {
                select: { category: true, note: true, fromUserId: true },
              },
            },
          },
        },
      });
      if (!profile) throw new TRPCError({ code: "NOT_FOUND" });
      return profile;
    }),

  update: protectedProcedure
    .input(
      z.object({
        displayName: z.string().min(2).max(80).optional(),
        bio: z.string().max(2000).nullish(),
        location: z.string().max(120).nullish(),
        availability: z.string().max(200).nullish(),
        simStats: simStatsSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.db.profile.update({
        where: { userId: ctx.user.id },
        data: input,
      });
    }),

  addCredential: protectedProcedure
    .input(
      z.object({
        kind: z.enum(["FIA_LICENSE", "KARTING", "SAFETY_CERT", "OTHER"]),
        title: z.string().min(2).max(120),
        issuer: z.string().max(120).optional(),
        year: z.number().int().min(1950).max(2100).optional(),
        details: z.string().max(1000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const profile = await ctx.db.profile.findUniqueOrThrow({
        where: { userId: ctx.user.id },
        select: { id: true },
      });
      return ctx.db.realWorldCredential.create({
        data: { ...input, profileId: profile.id },
      });
    }),

  removeCredential: protectedProcedure
    .input(z.object({ credentialId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      // Row-level authorization: only delete credentials on the caller's profile.
      const result = await ctx.db.realWorldCredential.deleteMany({
        where: {
          id: input.credentialId,
          profile: { userId: ctx.user.id },
        },
      });
      if (result.count === 0) throw new TRPCError({ code: "NOT_FOUND" });
      return { deleted: true };
    }),

  addIndustryExperience: protectedProcedure
    .input(
      z.object({
        role: z.string().min(2).max(120),
        company: z.string().min(1).max(120),
        years: z.number().int().min(0).max(60),
        summary: z.string().max(1000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const profile = await ctx.db.profile.findUniqueOrThrow({
        where: { userId: ctx.user.id },
        select: { id: true },
      });
      return ctx.db.industryExperience.create({
        data: { ...input, profileId: profile.id },
      });
    }),
});
