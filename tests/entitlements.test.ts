import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SubscriptionStatus, SubscriptionTier } from "@prisma/client";
import { hasActiveTier, isEntitledTo } from "@/server/services/billing";

/**
 * A paywall you cannot pay through is a wall.
 *
 * The bug this exists for: posting a job for a team required an active
 * Recruiter subscription, and the check never asked whether the deployment had
 * Stripe keys at all. Without them there is no checkout to complete and no
 * webhook to write the subscription row, so the feature was not gated — it was
 * removed, and the error helpfully pointed at a Billing page that could not
 * do anything about it.
 *
 * `hasActiveTier` stays factual so the billing page can still say plainly that
 * nothing is subscribed. `isEntitledTo` is the policy, and it is what every
 * feature check asks.
 */

const subscription = (over: Record<string, unknown> = {}) => ({
  status: SubscriptionStatus.ACTIVE,
  currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000),
  ...over,
});

/** Just enough Prisma to answer the one query these functions make. */
function fakeDb(found: ReturnType<typeof subscription> | null) {
  return {
    subscription: { findUnique: async () => found },
  } as never;
}

describe("entitlement when billing is switched off", () => {
  const saved = process.env.STRIPE_SECRET_KEY;
  beforeEach(() => {
    delete process.env.STRIPE_SECRET_KEY;
  });
  afterEach(() => {
    process.env.STRIPE_SECRET_KEY = saved;
  });

  it("lets everybody through when there is no way to subscribe", async () => {
    expect(
      await isEntitledTo(fakeDb(null), "user_1", SubscriptionTier.RECRUITER),
    ).toBe(true);
  });

  it("does not pretend they have a subscription", async () => {
    // The billing page has to keep telling the truth: entitled and subscribed
    // are different statements, and conflating them would show somebody a
    // plan they are not paying for.
    expect(
      await hasActiveTier(fakeDb(null), "user_1", SubscriptionTier.RECRUITER),
    ).toBe(false);
  });
});

describe("entitlement when billing is switched on", () => {
  const saved = process.env.STRIPE_SECRET_KEY;
  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = "sk_test_configured";
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = saved;
  });

  it("lets a live subscription through", async () => {
    expect(
      await isEntitledTo(
        fakeDb(subscription()),
        "user_1",
        SubscriptionTier.RECRUITER,
      ),
    ).toBe(true);
  });

  it("holds back somebody with no subscription", async () => {
    expect(
      await isEntitledTo(fakeDb(null), "user_1", SubscriptionTier.RECRUITER),
    ).toBe(false);
  });

  it("holds back a subscription that has lapsed", async () => {
    expect(
      await isEntitledTo(
        fakeDb(
          subscription({
            currentPeriodEnd: new Date(Date.now() - 86_400_000),
          }),
        ),
        "user_1",
        SubscriptionTier.RECRUITER,
      ),
    ).toBe(false);
  });

  it("holds back a subscription that is not active", async () => {
    expect(
      await isEntitledTo(
        fakeDb(subscription({ status: SubscriptionStatus.CANCELED })),
        "user_1",
        SubscriptionTier.RECRUITER,
      ),
    ).toBe(false);
  });
});
