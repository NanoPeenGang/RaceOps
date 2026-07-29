"use client";

import { SubscriptionTier } from "@prisma/client";
import { api } from "@/lib/trpc/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const TIERS: Array<{
  tier: SubscriptionTier;
  name: string;
  blurb: string;
  features: string[];
}> = [
  {
    tier: SubscriptionTier.RECRUITER,
    name: "Recruiter",
    blurb: "For teams hiring drivers and crew.",
    features: [
      "Post opportunities as your team",
      "Review and manage applications",
      "Gated search filters",
    ],
  },
  {
    tier: SubscriptionTier.SPONSOR_DISCOVERY,
    name: "Sponsor Discovery",
    blurb: "For drivers seeking sponsorship.",
    features: [
      "Search and browse sponsor profiles",
      "Sponsorship listing alerts",
    ],
  },
];

export default function BillingPage() {
  const status = api.billing.status.useQuery();
  const checkout = api.billing.createCheckout.useMutation({
    onSuccess: ({ url }) => {
      window.location.href = url;
    },
  });
  const portal = api.billing.createPortal.useMutation({
    onSuccess: ({ url }) => {
      window.location.href = url;
    },
  });
  const connect = api.billing.createConnectOnboarding.useMutation({
    onSuccess: ({ url }) => {
      window.location.href = url;
    },
  });

  const entitled = (tier: SubscriptionTier) =>
    tier === SubscriptionTier.RECRUITER
      ? status.data?.entitlements.recruiter
      : status.data?.entitlements.sponsorDiscovery;

  const anyError =
    checkout.error?.message ?? portal.error?.message ?? connect.error?.message;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold">Billing</h1>
        {status.data?.subscriptions.length ? (
          <Button
            variant="outline"
            disabled={portal.isPending}
            onClick={() => portal.mutate()}
          >
            Manage subscription
          </Button>
        ) : null}
      </div>

      {status.data && !status.data.stripeConfigured && (
        <p className="rounded-md border border-brand-red/30 bg-brand-red/5 p-3 text-sm">
          Billing is not configured on this deployment yet (Stripe keys
          missing).
        </p>
      )}
      {anyError && <p className="text-sm text-brand-red">{anyError}</p>}

      <div className="grid gap-6 md:grid-cols-2">
        {TIERS.map(({ tier, name, blurb, features }) => (
          <Card key={tier}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>{name}</CardTitle>
                {entitled(tier) && <Badge variant="verified">Active</Badge>}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-brand-black/70">{blurb}</p>
              <ul className="space-y-1 text-sm text-brand-black/80">
                {features.map((feature) => (
                  <li key={feature}>· {feature}</li>
                ))}
              </ul>
              {!entitled(tier) && (
                <Button
                  variant="primary"
                  disabled={checkout.isPending || !status.data?.stripeConfigured}
                  onClick={() => checkout.mutate({ tier })}
                >
                  {checkout.isPending ? "Redirecting…" : "Subscribe"}
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Marketplace payouts (Stripe Connect)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-brand-black/70">
            Receive payouts from brokered seat and sponsorship deals. RaceOps
            takes a marketplace fee at transaction time.
          </p>
          <Button
            variant="outline"
            disabled={connect.isPending || !status.data?.stripeConfigured}
            onClick={() => connect.mutate()}
          >
            {status.data?.connectAccountId
              ? "Continue Connect onboarding"
              : "Set up payouts"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
