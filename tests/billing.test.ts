import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SubscriptionStatus, SubscriptionTier } from "@prisma/client";
import {
  mapStripeStatus,
  priceIdForTier,
  tierForPriceId,
} from "@/server/services/billing";

describe("Stripe status mapping", () => {
  it("treats active and trialing as entitled", () => {
    expect(mapStripeStatus("active")).toBe(SubscriptionStatus.ACTIVE);
    expect(mapStripeStatus("trialing")).toBe(SubscriptionStatus.ACTIVE);
  });

  it("maps delinquent and ended states", () => {
    expect(mapStripeStatus("past_due")).toBe(SubscriptionStatus.PAST_DUE);
    expect(mapStripeStatus("unpaid")).toBe(SubscriptionStatus.PAST_DUE);
    expect(mapStripeStatus("canceled")).toBe(SubscriptionStatus.CANCELED);
    expect(mapStripeStatus("incomplete_expired")).toBe(
      SubscriptionStatus.CANCELED,
    );
    expect(mapStripeStatus("incomplete")).toBe(SubscriptionStatus.INCOMPLETE);
  });
});

describe("price/tier mapping", () => {
  beforeEach(() => {
    process.env.STRIPE_PRICE_RECRUITER = "price_recruiter_test";
    process.env.STRIPE_PRICE_SPONSOR = "price_sponsor_test";
  });
  afterEach(() => {
    delete process.env.STRIPE_PRICE_RECRUITER;
    delete process.env.STRIPE_PRICE_SPONSOR;
  });

  it("round-trips both tiers", () => {
    for (const tier of [
      SubscriptionTier.RECRUITER,
      SubscriptionTier.SPONSOR_DISCOVERY,
    ]) {
      expect(tierForPriceId(priceIdForTier(tier))).toBe(tier);
    }
  });

  it("returns null for unknown prices", () => {
    expect(tierForPriceId("price_unknown")).toBeNull();
  });

  it("throws when a price id is not configured", () => {
    delete process.env.STRIPE_PRICE_RECRUITER;
    expect(() => priceIdForTier(SubscriptionTier.RECRUITER)).toThrow(
      /not configured/i,
    );
  });
});
