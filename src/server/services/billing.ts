import Stripe from "stripe";
import { SubscriptionStatus, SubscriptionTier } from "@prisma/client";
import type { PrismaClient, User } from "@prisma/client";
import { db } from "@/server/db/client";

/**
 * Stripe billing (Phase 2).
 * Subscription tiers (spec Section 5):
 *   RECRUITER          — recruiter/team tier: gated search filters + team posting
 *   SPONSOR_DISCOVERY  — driver-side sponsor search access
 * Marketplace transaction fees run through Stripe Connect (Express accounts).
 */

let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error("STRIPE_SECRET_KEY is not configured.");
  }
  _stripe ??= new Stripe(process.env.STRIPE_SECRET_KEY);
  return _stripe;
}

export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

/** Price ids are configured per environment (test vs live) — never hardcoded. */
export function priceIdForTier(tier: SubscriptionTier): string {
  const priceId =
    tier === SubscriptionTier.RECRUITER
      ? process.env.STRIPE_PRICE_RECRUITER
      : process.env.STRIPE_PRICE_SPONSOR;
  if (!priceId) {
    throw new Error(`Stripe price id for tier ${tier} is not configured.`);
  }
  return priceId;
}

export function tierForPriceId(priceId: string): SubscriptionTier | null {
  if (priceId === process.env.STRIPE_PRICE_RECRUITER) {
    return SubscriptionTier.RECRUITER;
  }
  if (priceId === process.env.STRIPE_PRICE_SPONSOR) {
    return SubscriptionTier.SPONSOR_DISCOVERY;
  }
  return null;
}

/** Maps Stripe subscription statuses onto our four persisted states. */
export function mapStripeStatus(status: Stripe.Subscription.Status): SubscriptionStatus {
  switch (status) {
    case "active":
    case "trialing":
      return SubscriptionStatus.ACTIVE;
    case "past_due":
    case "unpaid":
      return SubscriptionStatus.PAST_DUE;
    case "canceled":
    case "incomplete_expired":
      return SubscriptionStatus.CANCELED;
    case "incomplete":
    case "paused":
    default:
      return SubscriptionStatus.INCOMPLETE;
  }
}

export function appBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

export async function getOrCreateStripeCustomer(user: User): Promise<string> {
  if (user.stripeCustomerId) return user.stripeCustomerId;
  const customer = await getStripe().customers.create({
    email: user.email,
    metadata: { raceopsUserId: user.id },
  });
  await db.user.update({
    where: { id: user.id },
    data: { stripeCustomerId: customer.id },
  });
  return customer.id;
}

export async function createTierCheckoutSession(
  user: User,
  tier: SubscriptionTier,
): Promise<string> {
  const customerId = await getOrCreateStripeCustomer(user);
  const session = await getStripe().checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: priceIdForTier(tier), quantity: 1 }],
    success_url: `${appBaseUrl()}/billing?status=success`,
    cancel_url: `${appBaseUrl()}/billing?status=canceled`,
    metadata: { raceopsUserId: user.id, tier },
  });
  if (!session.url) throw new Error("Stripe did not return a checkout URL.");
  return session.url;
}

export async function createBillingPortalSession(user: User): Promise<string> {
  const customerId = await getOrCreateStripeCustomer(user);
  const session = await getStripe().billingPortal.sessions.create({
    customer: customerId,
    return_url: `${appBaseUrl()}/billing`,
  });
  return session.url;
}

/**
 * Stripe Connect (Express) onboarding for marketplace payouts —
 * the account that receives brokered seat/sponsorship deal proceeds,
 * with RaceOps taking its fee at charge time.
 */
export async function createConnectOnboardingLink(user: User): Promise<string> {
  const stripe = getStripe();
  let accountId = user.stripeConnectAccountId;
  if (!accountId) {
    const account = await stripe.accounts.create({
      type: "express",
      email: user.email,
      metadata: { raceopsUserId: user.id },
    });
    accountId = account.id;
    await db.user.update({
      where: { id: user.id },
      data: { stripeConnectAccountId: accountId },
    });
  }
  const link = await stripe.accountLinks.create({
    account: accountId,
    type: "account_onboarding",
    refresh_url: `${appBaseUrl()}/billing?connect=refresh`,
    return_url: `${appBaseUrl()}/billing?connect=complete`,
  });
  return link.url;
}

/**
 * Upserts the local subscription row from a Stripe subscription object.
 * Called from the webhook — the single writer for subscription state.
 */
export async function syncSubscriptionFromStripe(
  subscription: Stripe.Subscription,
): Promise<void> {
  const item = subscription.items.data[0];
  const priceId = item?.price.id;
  const tier = priceId ? tierForPriceId(priceId) : null;
  if (!tier) {
    console.warn(
      `Stripe subscription ${subscription.id} has unrecognized price ${priceId}; skipping sync.`,
    );
    return;
  }

  const customerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer.id;
  const user = await db.user.findUnique({
    where: { stripeCustomerId: customerId },
  });
  if (!user) {
    console.warn(
      `No user for Stripe customer ${customerId}; skipping subscription sync.`,
    );
    return;
  }

  const status = mapStripeStatus(subscription.status);
  const currentPeriodEnd = new Date(item.current_period_end * 1000);

  await db.subscription.upsert({
    where: { stripeSubscriptionId: subscription.id },
    create: {
      userId: user.id,
      tier,
      status,
      stripeSubscriptionId: subscription.id,
      currentPeriodEnd,
    },
    update: { status, currentPeriodEnd, tier },
  });
}

/** Entitlement check used to gate paid features. */
export async function hasActiveTier(
  prisma: PrismaClient,
  userId: string,
  tier: SubscriptionTier,
): Promise<boolean> {
  const subscription = await prisma.subscription.findUnique({
    where: { userId_tier: { userId, tier } },
  });
  return (
    !!subscription &&
    subscription.status === SubscriptionStatus.ACTIVE &&
    subscription.currentPeriodEnd.getTime() > Date.now()
  );
}
