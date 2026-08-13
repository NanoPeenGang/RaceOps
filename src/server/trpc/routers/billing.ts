import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { SubscriptionTier } from "@prisma/client";
import { createTRPCRouter, protectedProcedure } from "@/server/trpc/trpc";
import {
  createBillingPortalSession,
  createConnectOnboardingLink,
  createTierCheckoutSession,
  isEntitledTo,
  isStripeConfigured,
} from "@/server/services/billing";

function requireStripe() {
  if (!isStripeConfigured()) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Billing is not configured on this deployment yet.",
    });
  }
}

export const billingRouter = createTRPCRouter({
  status: protectedProcedure.query(async ({ ctx }) => {
    const subscriptions = await ctx.db.subscription.findMany({
      where: { userId: ctx.user.id },
    });
    return {
      stripeConfigured: isStripeConfigured(),
      connectAccountId: ctx.user.stripeConnectAccountId,
      subscriptions,
      /*
       * What the caller may actually do, which is what every feature check
       * asks. On a deployment with no Stripe keys this is true throughout —
       * there is no checkout to complete, so gating would remove features
       * rather than sell them. `subscriptions` above stays factual, so the
       * billing page can still say plainly that nothing is subscribed.
       */
      entitlements: {
        recruiter: await isEntitledTo(
          ctx.db,
          ctx.user.id,
          SubscriptionTier.RECRUITER,
        ),
        sponsorDiscovery: await isEntitledTo(
          ctx.db,
          ctx.user.id,
          SubscriptionTier.SPONSOR_DISCOVERY,
        ),
      },
    };
  }),

  createCheckout: protectedProcedure
    .input(z.object({ tier: z.nativeEnum(SubscriptionTier) }))
    .mutation(async ({ ctx, input }) => {
      requireStripe();
      const url = await createTierCheckoutSession(ctx.user, input.tier);
      return { url };
    }),

  createPortal: protectedProcedure.mutation(async ({ ctx }) => {
    requireStripe();
    const url = await createBillingPortalSession(ctx.user);
    return { url };
  }),

  createConnectOnboarding: protectedProcedure.mutation(async ({ ctx }) => {
    requireStripe();
    const url = await createConnectOnboardingLink(ctx.user);
    return { url };
  }),
});
