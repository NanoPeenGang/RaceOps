import { SponsorshipStatus } from "@prisma/client";

/**
 * The sponsor's side of a sponsorship.
 *
 * The same rows as the team console, read from the other end. That flip
 * changes what the numbers mean, which is why this is its own module rather
 * than a re-use of `summarizeSponsorships`: to a team an OFFERED deal is work
 * arriving, and to a sponsor it is money offered and not yet answered. The
 * team's summary counts it as something to action; here it is counted as
 * outstanding, and deliberately *not* added to spend.
 */

/** A sponsor is waiting on the team for these. */
export const AWAITING_TEAM: SponsorshipStatus[] = [
  SponsorshipStatus.OFFERED,
  SponsorshipStatus.NEGOTIATING,
];

export const SPONSOR_STATUS_LABELS: Record<SponsorshipStatus, string> = {
  OFFERED: "Awaiting reply",
  NEGOTIATING: "In negotiation",
  ACTIVE: "Live",
  DECLINED: "Declined",
  EXPIRED: "Ended",
};

/** Reading order for the dashboard: what needs you, then what is running. */
export const SPONSOR_STATUS_ORDER: SponsorshipStatus[] = [
  SponsorshipStatus.OFFERED,
  SponsorshipStatus.NEGOTIATING,
  SponsorshipStatus.ACTIVE,
  SponsorshipStatus.EXPIRED,
  SponsorshipStatus.DECLINED,
];

export interface SponsorDeal {
  status: SponsorshipStatus;
  valueMinor: number | null;
  currency: string;
  startDate: Date | null;
  endDate: Date | null;
  teamId: string;
}

export interface SponsorTotals {
  /** Every deal, however it ended. */
  total: number;
  byStatus: Record<SponsorshipStatus, number>;
  /**
   * Committed spend on live deals, per currency, in minor units.
   *
   * Split by currency rather than summed. A sponsor backing teams in two
   * countries holds deals in two currencies, and one total across both would
   * need an exchange rate this platform has no business inventing.
   */
  liveSpendByCurrency: Record<string, number>;
  /** Offered and not yet answered — money on the table, not money spent. */
  pendingValueByCurrency: Record<string, number>;
  /** Distinct teams with at least one live deal. */
  liveTeamCount: number;
  /** Distinct teams approached at any point. */
  teamsApproached: number;
}

const ZERO_BY_STATUS = (): Record<SponsorshipStatus, number> => ({
  OFFERED: 0,
  NEGOTIATING: 0,
  ACTIVE: 0,
  DECLINED: 0,
  EXPIRED: 0,
});

export function summarizeSponsorPortfolio(
  deals: readonly SponsorDeal[],
): SponsorTotals {
  const byStatus = ZERO_BY_STATUS();
  const liveSpendByCurrency: Record<string, number> = {};
  const pendingValueByCurrency: Record<string, number> = {};
  const liveTeams = new Set<string>();
  const allTeams = new Set<string>();

  for (const deal of deals) {
    byStatus[deal.status] += 1;
    allTeams.add(deal.teamId);

    const currency = deal.currency.toUpperCase();
    const value = deal.valueMinor ?? 0;

    if (deal.status === SponsorshipStatus.ACTIVE) {
      liveTeams.add(deal.teamId);
      if (value > 0) {
        liveSpendByCurrency[currency] =
          (liveSpendByCurrency[currency] ?? 0) + value;
      }
    } else if (AWAITING_TEAM.includes(deal.status) && value > 0) {
      pendingValueByCurrency[currency] =
        (pendingValueByCurrency[currency] ?? 0) + value;
    }
  }

  return {
    total: deals.length,
    byStatus,
    liveSpendByCurrency,
    pendingValueByCurrency,
    liveTeamCount: liveTeams.size,
    teamsApproached: allTeams.size,
  };
}

/** How long an offer has sat unanswered. */
export function daysWaiting(createdAt: Date, now = new Date()): number {
  const ms = now.getTime() - createdAt.getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}

/**
 * An offer nobody has answered in a fortnight.
 *
 * Not a failure state and not chased automatically — a small team's manager
 * checks the platform between race weekends, not daily. It is shown so a
 * sponsor can decide whether to follow up rather than assume they were
 * ignored.
 */
export const STALE_OFFER_DAYS = 14;

export function isStaleOffer(
  deal: { status: SponsorshipStatus; createdAt: Date },
  now = new Date(),
): boolean {
  return (
    deal.status === SponsorshipStatus.OFFERED &&
    daysWaiting(deal.createdAt, now) >= STALE_OFFER_DAYS
  );
}

/**
 * A live deal running out.
 *
 * Renewal is the thing sponsors forget, and an expired deal means logos come
 * off the car. Deals with no end date never appear — an open-ended agreement
 * is not expiring, and warning about one would be noise.
 */
export const RENEWAL_WINDOW_DAYS = 60;

export function daysUntilEnd(endDate: Date, now = new Date()): number {
  const ms = endDate.getTime() - now.getTime();
  return Math.ceil(ms / 86_400_000);
}

export function isUpForRenewal(
  deal: { status: SponsorshipStatus; endDate: Date | null },
  now = new Date(),
): boolean {
  if (deal.status !== SponsorshipStatus.ACTIVE || !deal.endDate) return false;
  const days = daysUntilEnd(deal.endDate, now);
  return days <= RENEWAL_WINDOW_DAYS;
}

/**
 * Ordering for the deal list: the ones the sponsor can act on first.
 *
 * Within a status, most recent first — a sponsor's newest pitch is the one
 * they are thinking about.
 */
export function sortSponsorDeals<
  T extends { status: SponsorshipStatus; createdAt: Date },
>(deals: readonly T[]): T[] {
  return [...deals].sort((a, b) => {
    const rank =
      SPONSOR_STATUS_ORDER.indexOf(a.status) -
      SPONSOR_STATUS_ORDER.indexOf(b.status);
    if (rank !== 0) return rank;
    return b.createdAt.getTime() - a.createdAt.getTime();
  });
}
