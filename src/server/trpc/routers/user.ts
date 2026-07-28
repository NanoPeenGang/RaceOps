import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { ProfileType } from "@prisma/client";
import {
  createTRPCRouter,
  protectedProcedure,
  publicProcedure,
} from "@/server/trpc/trpc";
import { clerkClient } from "@clerk/nextjs/server";

const onboardingInput = z.object({
  displayName: z.string().min(2).max(80),
  profileTypes: z.array(z.nativeEnum(ProfileType)).min(1).max(6),
  bio: z.string().max(2000).optional(),
  location: z.string().max(120).optional(),
});

export const userRouter = createTRPCRouter({
  /** The signed-in user's account + profile, or null if not yet onboarded. */
  me: publicProcedure.query(async ({ ctx }) => {
    if (!ctx.clerkUserId) return null;
    return ctx.db.user.findUnique({
      where: { authProviderId: ctx.clerkUserId },
      include: { profile: true },
    });
  }),

  /**
   * Provisions the local User + Profile for a signed-in Clerk identity.
   * Idempotent guard: refuses if the account already exists.
   */
  completeOnboarding: publicProcedure
    .input(onboardingInput)
    .mutation(async ({ ctx, input }) => {
      if (!ctx.clerkUserId) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }
      const existing = await ctx.db.user.findUnique({
        where: { authProviderId: ctx.clerkUserId },
      });
      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Account already onboarded.",
        });
      }

      const client = await clerkClient();
      const clerkUser = await client.users.getUser(ctx.clerkUserId);
      const email = clerkUser.primaryEmailAddress?.emailAddress;
      if (!email) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "A verified email address is required.",
        });
      }

      return ctx.db.user.create({
        data: {
          email,
          authProviderId: ctx.clerkUserId,
          profileTypes: input.profileTypes,
          profile: {
            create: {
              displayName: input.displayName,
              bio: input.bio,
              location: input.location,
            },
          },
        },
        include: { profile: true },
      });
    }),

  /** GDPR/CCPA: full export of the user's stored data. */
  exportData: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db.user.findUniqueOrThrow({
      where: { id: ctx.user.id },
      include: {
        profile: {
          include: { realWorldCredentials: true, industryExperience: true },
        },
        teamMemberships: { include: { team: true } },
        applications: true,
        sponsorshipProfile: true,
        raceReports: true,
        endorsementsGiven: true,
        endorsementsReceived: true,
        media: true,
      },
    });
  }),

  /** GDPR/CCPA: delete the local account and all owned rows (cascades). */
  deleteAccount: protectedProcedure.mutation(async ({ ctx }) => {
    await ctx.db.user.delete({ where: { id: ctx.user.id } });
    return { deleted: true };
  }),
});
