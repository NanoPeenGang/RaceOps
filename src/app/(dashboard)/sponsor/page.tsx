"use client";

import { useState } from "react";
import Link from "next/link";
import { SponsorshipStatus } from "@prisma/client";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/trpc/root";
import { api } from "@/lib/trpc/client";
import {
  daysUntilEnd,
  daysWaiting,
  RENEWAL_WINDOW_DAYS,
  SPONSOR_STATUS_LABELS,
  STALE_OFFER_DAYS,
} from "@/lib/sponsor-dashboard";
import { formatDealValue } from "@/lib/sponsorship";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState, PageHeader, Section, Stat } from "@/components/ui/page";
import { Tabs } from "@/components/ui/tabs";

/**
 * The sponsor's console.
 *
 * A sponsor's deals are scattered across as many team pages as they back, and
 * none of those pages is theirs to open. This is the one screen that is: what
 * is live, what is waiting on a reply, what is about to lapse, and who else
 * they could approach.
 */

type Dashboard = inferRouterOutputs<AppRouter>["sponsor"]["dashboard"];
type Deal = Dashboard["deals"][number];

export default function SponsorPage() {
  const access = api.sponsor.access.useQuery();

  if (access.isLoading) {
    return <p className="text-brand-black/60">Loading…</p>;
  }

  // Not an error screen: somebody who has not applied yet is not doing
  // anything wrong, and a FORBIDDEN here would read as a broken page.
  if (!access.data?.approved) {
    return (
      <div className="space-y-8">
        <PageHeader
          title="Sponsor console"
          description="Track every deal you have across the platform in one place."
        />
        <EmptyState
          title="You are not registered as a sponsor yet"
          description="A sponsor account can pitch any team on the platform, which is exactly what spam wants — so it needs approving first. The application takes a minute and covers you for every team afterwards."
          action={
            <Link href="/apply">
              <Button variant="primary">Apply</Button>
            </Link>
          }
        />
      </div>
    );
  }

  return <SponsorConsole />;
}

function SponsorConsole() {
  const dashboard = api.sponsor.dashboard.useQuery();
  const data = dashboard.data;

  if (!data) return <p className="text-brand-black/60">Loading…</p>;

  const { totals } = data;
  const stale = new Set(data.stale);
  const renewing = new Set(data.renewing);
  const needsYou = stale.size + renewing.size;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Sponsor console"
        description="Every deal you hold, across every team."
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Live deals"
          value={totals.byStatus.ACTIVE}
          hint={`${totals.liveTeamCount} team(s)`}
        />
        <Stat
          label="Awaiting a reply"
          value={totals.byStatus.OFFERED + totals.byStatus.NEGOTIATING}
        />
        <Stat
          label="Needs you"
          value={needsYou}
          tone={needsYou > 0 ? "alert" : "default"}
          hint={
            needsYou > 0
              ? "Unanswered offers or deals running out"
              : "Nothing waiting"
          }
        />
        <Stat label="Teams approached" value={totals.teamsApproached} />
      </div>

      <Section
        title="Committed spend"
        description="Live deals only, split by currency — one total across currencies would need an exchange rate this platform has no business inventing."
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Object.entries(totals.liveSpendByCurrency).length === 0 ? (
            <p className="text-sm text-brand-black/60">
              Nothing live with a value on it.
            </p>
          ) : (
            Object.entries(totals.liveSpendByCurrency).map(
              ([currency, minor]) => (
                <Stat
                  key={currency}
                  label={`Live — ${currency}`}
                  value={formatDealValue(minor, currency)}
                />
              ),
            )
          )}
          {Object.entries(totals.pendingValueByCurrency).map(
            ([currency, minor]) => (
              <Stat
                key={`pending-${currency}`}
                label={`Offered, unanswered — ${currency}`}
                value={formatDealValue(minor, currency)}
                hint="Not counted as spend until a team accepts."
              />
            ),
          )}
        </div>
      </Section>

      <Tabs
        tabs={[
          {
            id: "deals",
            label: "My deals",
            badge: totals.total || undefined,
            content: (
              <div className="space-y-3 pt-4">
                {data.deals.length === 0 ? (
                  <EmptyState
                    title="No deals yet"
                    description="Find a team on the Discover tab and make them an offer."
                  />
                ) : (
                  data.deals.map((deal) => (
                    <DealCard
                      key={deal.id}
                      deal={deal}
                      stale={stale.has(deal.id)}
                      renewing={renewing.has(deal.id)}
                    />
                  ))
                )}
              </div>
            ),
          },
          {
            id: "discover",
            label: "Find teams",
            content: <Discover />,
          },
        ]}
      />
    </div>
  );
}

function DealCard({
  deal,
  stale,
  renewing,
}: {
  deal: Deal;
  stale: boolean;
  renewing: boolean;
}) {
  const utils = api.useUtils();
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const withdraw = api.sponsor.withdrawOffer.useMutation({
    meta: {
      silenceError: true,
      successMessage: "Offer withdrawn and the team told.",
    },
    onSuccess: async () => {
      await utils.sponsor.dashboard.invalidate();
      setConfirming(false);
    },
  });

  return (
    <Card className={stale || renewing ? "border-brand-red/40" : undefined}>
      <CardContent className="space-y-3 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <Avatar src={deal.team.logoUrl} name={deal.team.name} size="sm" />
            <div className="min-w-0">
              <Link
                href={`/teams/${deal.team.slug}`}
                className="truncate font-medium hover:text-brand-red"
              >
                {deal.team.name}
              </Link>
              <p className="text-xs text-brand-black/60">
                {[deal.tier, deal.season, deal.team.homeBase]
                  .filter(Boolean)
                  .join(" · ") || "No package named"}
              </p>
            </div>
          </div>
          <div className="text-right">
            <p className="font-semibold tabular-nums">
              {formatDealValue(deal.valueMinor, deal.currency)}
            </p>
            <Badge
              variant={
                deal.status === SponsorshipStatus.ACTIVE
                  ? "verified"
                  : "default"
              }
            >
              {SPONSOR_STATUS_LABELS[deal.status]}
            </Badge>
          </div>
        </div>

        {stale && (
          <p className="rounded-md bg-brand-red/[0.05] p-3 text-sm">
            Sent {daysWaiting(deal.createdAt)} days ago and nobody has picked it
            up. Small teams check between race weekends rather than daily — it
            may be worth a message before you assume no.
          </p>
        )}

        {renewing && deal.endDate && (
          <p className="rounded-md bg-brand-red/[0.05] p-3 text-sm">
            Ends in {daysUntilEnd(deal.endDate)} day(s). Renewals are agreed as
            a new deal, so the history of what was agreed when stays intact.
          </p>
        )}

        {deal.notes && (
          <p className="whitespace-pre-wrap text-sm text-brand-black/70">
            {deal.notes}
          </p>
        )}

        {deal.status === SponsorshipStatus.OFFERED && (
          <div className="space-y-2 border-t border-brand-black/10 pt-3">
            {confirming ? (
              <>
                <input
                  className="w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
                  value={reason}
                  maxLength={2000}
                  placeholder="Why, so the team is not left guessing (optional)"
                  onChange={(e) => setReason(e.target.value)}
                />
                <div className="flex gap-2">
                  <Button
                    variant="primary"
                    disabled={withdraw.isPending}
                    onClick={() =>
                      withdraw.mutate({
                        sponsorshipId: deal.id,
                        reason: reason.trim() || undefined,
                      })
                    }
                  >
                    Withdraw the offer
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setConfirming(false)}
                  >
                    Keep it open
                  </Button>
                </div>
              </>
            ) : (
              <Button variant="outline" onClick={() => setConfirming(true)}>
                Withdraw
              </Button>
            )}
            {withdraw.error && (
              <p className="text-sm text-brand-red">{withdraw.error.message}</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Discover() {
  const [typed, setTyped] = useState("");
  const [query, setQuery] = useState<string | undefined>();
  const teams = api.sponsor.discoverTeams.useQuery({ query });

  return (
    <div className="space-y-4 pt-4">
      <div className="flex flex-wrap gap-2">
        <input
          className="min-w-64 flex-1 rounded-md border border-brand-black/20 px-3 py-2 text-sm"
          value={typed}
          placeholder="Name, home base or what they race"
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") setQuery(typed.trim() || undefined);
          }}
        />
        <Button
          variant="outline"
          onClick={() => setQuery(typed.trim() || undefined)}
        >
          Search
        </Button>
      </div>

      {teams.isLoading && <p className="text-brand-black/60">Loading…</p>}

      {teams.data?.teams.length === 0 && (
        <EmptyState
          title="No teams match"
          description="Try a broader search, or clear it to browse everybody."
        />
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {teams.data?.teams.map((team) => (
          <Card key={team.id} className="h-full">
            <CardContent className="flex h-full flex-col gap-3 p-4">
              <div className="flex items-start gap-3">
                <Avatar src={team.logoUrl} name={team.name} size="md" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/teams/${team.slug}`}
                      className="truncate font-medium hover:text-brand-red"
                    >
                      {team.name}
                    </Link>
                    {/* Marked rather than hidden: renewing with a team you
                        backed last season is the common case. */}
                    {team.existingStatuses.length > 0 && (
                      <Badge variant="outline">
                        {team.existingStatuses.includes(
                          SponsorshipStatus.ACTIVE,
                        )
                          ? "You back them"
                          : "Already approached"}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-brand-black/60">
                    {[team.homeBase, `${team._count.roster} on the roster`]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
              </div>
              {team.description && (
                <p className="line-clamp-3 text-sm text-brand-black/70">
                  {team.description}
                </p>
              )}
              <div className="mt-auto">
                <Link href={`/teams/${team.slug}`}>
                  <Button variant="outline">Open team page</Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <p className="text-xs text-brand-black/50">
        Offers are made from a team&rsquo;s page. An unanswered one sits for{" "}
        {STALE_OFFER_DAYS} days before this console flags it, and a live deal is
        flagged {RENEWAL_WINDOW_DAYS} days before it ends.
      </p>
    </div>
  );
}
