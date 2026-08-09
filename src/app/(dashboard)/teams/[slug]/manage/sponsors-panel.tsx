"use client";

import { useState } from "react";
import { SponsorshipStatus } from "@prisma/client";
import { api } from "@/lib/trpc/client";
import {
  CLOSED_SPONSORSHIP_STATUSES,
  OPEN_SPONSORSHIP_STATUSES,
  SPONSORSHIP_STATUS_LABELS,
  formatDealValue,
  nextSponsorshipStatuses,
  parseDealValue,
} from "@/lib/sponsorship";
import { isTeamManager } from "@/lib/teams";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { TeamDashboard, TeamSponsorships } from "./types";
import { ListSkeleton } from "@/components/ui/skeleton";
import { Section } from "@/components/ui/page";

/**
 * Sponsorship offers and active deals.
 *
 * Offers arriving through the platform land as OFFERED for the team to accept,
 * negotiate or decline; managers can also record a deal agreed offline
 * straight into ACTIVE. Commercial terms are visible to the team only.
 */
export function SponsorsPanel({ team }: { team: TeamDashboard }) {
  const utils = api.useUtils();
  const canManage = isTeamManager(team.myRole);
  const sponsorships = api.sponsorship.forTeam.useQuery(
    { teamId: team.id },
    { meta: { silenceError: true } },
  );
  const [showForm, setShowForm] = useState(false);

  const refresh = () =>
    utils.sponsorship.forTeam.invalidate({ teamId: team.id });
  const setStatus = api.sponsorship.setStatus.useMutation({
    onSuccess: refresh,
  });
  const remove = api.sponsorship.remove.useMutation({ onSuccess: refresh });

  if (sponsorships.isLoading) {
    return <ListSkeleton />;
  }
  if (sponsorships.error) {
    return (
      <Section title="Sponsorship">
        <p className="text-sm text-brand-black/60">
          {sponsorships.error.message}
        </p>
      </Section>
    );
  }

  const { deals, summary } = sponsorships.data!;
  const offers = deals.filter((deal) =>
    OPEN_SPONSORSHIP_STATUSES.includes(deal.status),
  );
  const active = deals.filter(
    (deal) => deal.status === SponsorshipStatus.ACTIVE,
  );
  const closed = deals.filter((deal) =>
    CLOSED_SPONSORSHIP_STATUSES.includes(deal.status),
  );

  const mutationError = setStatus.error ?? remove.error;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-semibold">Sponsorship</h2>
        {canManage && (
          <Button
            size="sm"
            variant="primary"
            onClick={() => setShowForm((v) => !v)}
          >
            {showForm ? "Cancel" : "Record a deal"}
          </Button>
        )}
      </div>

      <div className="flex flex-wrap gap-6 text-sm">
        <Stat label="Active sponsors" value={String(summary.activeCount)} />
        <Stat label="Open offers" value={String(summary.openOfferCount)} />
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-black/50">
            Committed value
          </p>
          <p className="text-lg font-bold tabular-nums">
            {Object.keys(summary.activeValueByCurrency).length === 0
              ? "—"
              : Object.entries(summary.activeValueByCurrency)
                  .map(([currency, value]) => formatDealValue(value, currency))
                  .join(" + ")}
          </p>
        </div>
      </div>

      {showForm && canManage && (
        <DealForm
          teamId={team.id}
          onDone={() => {
            setShowForm(false);
            refresh();
          }}
        />
      )}

      {offers.length > 0 && (
        <DealGroup
          title={`Offers needing a decision (${offers.length})`}
          deals={offers}
          canManage={canManage}
          onSetStatus={(id, status) =>
            setStatus.mutate({ sponsorshipId: id, status })
          }
          onRemove={(id) => remove.mutate({ sponsorshipId: id })}
          isPending={setStatus.isPending || remove.isPending}
          highlight
        />
      )}

      <DealGroup
        title={`Active sponsors (${active.length})`}
        deals={active}
        canManage={canManage}
        onSetStatus={(id, status) =>
          setStatus.mutate({ sponsorshipId: id, status })
        }
        onRemove={(id) => remove.mutate({ sponsorshipId: id })}
        isPending={setStatus.isPending || remove.isPending}
        emptyMessage="No active sponsors yet."
      />

      {mutationError && (
        <p className="text-sm text-brand-red">{mutationError.message}</p>
      )}

      {closed.length > 0 && (
        <details className="rounded-md border border-brand-black/10 p-3">
          <summary className="cursor-pointer text-sm font-medium text-brand-black/70">
            Closed ({closed.length})
          </summary>
          <div className="mt-3 space-y-1.5 text-sm">
            {closed.map((deal) => (
              <div
                key={deal.id}
                className="flex flex-wrap items-center justify-between gap-2"
              >
                <span>{deal.sponsorName}</span>
                <span className="text-xs text-brand-black/60">
                  {SPONSORSHIP_STATUS_LABELS[deal.status]}
                  {deal.season ? ` · ${deal.season}` : ""}
                  {canManage && (
                    <button
                      type="button"
                      className="ml-3 text-brand-black/40 hover:text-brand-red"
                      disabled={remove.isPending}
                      onClick={() => remove.mutate({ sponsorshipId: deal.id })}
                    >
                      Delete
                    </button>
                  )}
                </span>
              </div>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}

function DealGroup({
  title,
  deals,
  canManage,
  onSetStatus,
  onRemove,
  isPending,
  highlight = false,
  emptyMessage,
}: {
  title: string;
  deals: TeamSponsorships["deals"];
  canManage: boolean;
  onSetStatus: (id: string, status: SponsorshipStatus) => void;
  onRemove: (id: string) => void;
  isPending: boolean;
  highlight?: boolean;
  emptyMessage?: string;
}) {
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-brand-black/50">
        {title}
      </h3>
      {deals.length === 0 && emptyMessage && (
        <p className="text-sm text-brand-black/60">{emptyMessage}</p>
      )}
      {deals.map((deal) => (
        <Card
          key={deal.id}
          className={
            highlight ? "border-brand-red/40 bg-brand-red/5" : undefined
          }
        >
          <CardContent className="space-y-2 p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium">
                  {deal.websiteUrl ? (
                    <a
                      href={deal.websiteUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-brand-red hover:underline"
                    >
                      {deal.sponsorName}
                    </a>
                  ) : (
                    deal.sponsorName
                  )}
                </p>
                <p className="text-xs text-brand-black/60">
                  {[
                    deal.tier,
                    formatDealValue(deal.valueMinor, deal.currency),
                    deal.season,
                    deal.startDate &&
                      `from ${new Date(deal.startDate).toLocaleDateString()}`,
                    deal.endDate &&
                      `to ${new Date(deal.endDate).toLocaleDateString()}`,
                    deal.sponsorUser?.profile?.displayName &&
                      `via ${deal.sponsorUser.profile.displayName}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <Badge
                variant={
                  deal.status === SponsorshipStatus.ACTIVE
                    ? "verified"
                    : "default"
                }
              >
                {SPONSORSHIP_STATUS_LABELS[deal.status]}
              </Badge>
            </div>

            {deal.notes && (
              <p className="whitespace-pre-wrap text-sm text-brand-black/80">
                {deal.notes}
              </p>
            )}
            {deal.contactEmail && (
              <p className="text-xs text-brand-black/60">{deal.contactEmail}</p>
            )}

            {canManage && (
              <div className="flex flex-wrap gap-2">
                {nextSponsorshipStatuses(deal.status).map((status) => (
                  <Button
                    key={status}
                    size="sm"
                    variant={
                      status === SponsorshipStatus.ACTIVE
                        ? "primary"
                        : "outline"
                    }
                    disabled={isPending}
                    onClick={() => onSetStatus(deal.id, status)}
                  >
                    {status === SponsorshipStatus.ACTIVE
                      ? "Accept"
                      : SPONSORSHIP_STATUS_LABELS[status]}
                  </Button>
                ))}
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={isPending}
                  onClick={() => onRemove(deal.id)}
                >
                  Delete
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/** Statuses a manager may create a deal in, mirroring the router's input. */
type CreatableStatus =
  | typeof SponsorshipStatus.OFFERED
  | typeof SponsorshipStatus.NEGOTIATING
  | typeof SponsorshipStatus.ACTIVE;

const CREATABLE_STATUSES: CreatableStatus[] = [
  SponsorshipStatus.ACTIVE,
  SponsorshipStatus.NEGOTIATING,
  SponsorshipStatus.OFFERED,
];

function DealForm({ teamId, onDone }: { teamId: string; onDone: () => void }) {
  const [sponsorName, setSponsorName] = useState("");
  const [tier, setTier] = useState("");
  const [value, setValue] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [season, setSeason] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [notes, setNotes] = useState("");
  // A manually recorded deal starts somewhere in play — a manager has no
  // reason to create one already declined or expired.
  const [status, setStatus] = useState<CreatableStatus>(
    SponsorshipStatus.ACTIVE,
  );

  const create = api.sponsorship.create.useMutation({
    meta: { silenceError: true },
    onSuccess: onDone,
  });

  const parsedValue = value.trim() === "" ? null : parseDealValue(value);
  const valueIsInvalid = value.trim() !== "" && parsedValue === null;

  return (
    <Card className="max-w-2xl">
      <CardContent className="space-y-4 p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-medium">
            Sponsor
            <input
              className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
              value={sponsorName}
              onChange={(e) => setSponsorName(e.target.value)}
              placeholder="Apex Brake Systems"
            />
          </label>
          <label className="block text-sm font-medium">
            Package <span className="text-brand-black/50">(optional)</span>
            <input
              className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
              value={tier}
              onChange={(e) => setTier(e.target.value)}
              placeholder="Primary · Associate · Contingency"
            />
          </label>
          <label className="block text-sm font-medium">
            Value <span className="text-brand-black/50">(optional)</span>
            <input
              className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="25,000"
            />
            {valueIsInvalid && (
              <span className="mt-1 block text-xs text-brand-red">
                Enter an amount like 25000 or 25,000.50
              </span>
            )}
          </label>
          <label className="block text-sm font-medium">
            Currency
            <input
              className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm uppercase"
              value={currency}
              maxLength={3}
              onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            />
          </label>
          <label className="block text-sm font-medium">
            Season <span className="text-brand-black/50">(optional)</span>
            <input
              className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
              value={season}
              onChange={(e) => setSeason(e.target.value)}
              placeholder="2026"
            />
          </label>
          <label className="block text-sm font-medium">
            Status
            <select
              className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
              value={status}
              onChange={(e) => setStatus(e.target.value as CreatableStatus)}
            >
              {CREATABLE_STATUSES.map((option) => (
                <option key={option} value={option}>
                  {SPONSORSHIP_STATUS_LABELS[option]}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-medium">
            Contact email{" "}
            <span className="text-brand-black/50">(optional)</span>
            <input
              className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
            />
          </label>
          <label className="block text-sm font-medium">
            Website <span className="text-brand-black/50">(optional)</span>
            <input
              className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
              value={websiteUrl}
              onChange={(e) => setWebsiteUrl(e.target.value)}
              placeholder="https://…"
            />
          </label>
        </div>
        <label className="block text-sm font-medium">
          Notes <span className="text-brand-black/50">(optional)</span>
          <textarea
            rows={3}
            className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="What's included — livery space, socials, hospitality…"
          />
        </label>

        {create.error && (
          <p className="text-sm text-brand-red">{create.error.message}</p>
        )}
        <Button
          variant="primary"
          disabled={
            create.isPending || sponsorName.trim().length < 2 || valueIsInvalid
          }
          onClick={() =>
            create.mutate({
              teamId,
              sponsorName: sponsorName.trim(),
              tier: tier.trim() || undefined,
              valueMinor: parsedValue ?? undefined,
              currency: currency.trim() || "USD",
              season: season.trim() || undefined,
              contactEmail: contactEmail.trim() || undefined,
              websiteUrl: websiteUrl.trim() || undefined,
              notes: notes.trim() || undefined,
              status,
            })
          }
        >
          {create.isPending ? "Saving…" : "Save deal"}
        </Button>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-brand-black/50">
        {label}
      </p>
      <p className="text-lg font-bold tabular-nums">{value}</p>
    </div>
  );
}
