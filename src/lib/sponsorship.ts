import { SponsorshipStatus } from "@prisma/client";

/**
 * Sponsorship deal lifecycle and money formatting.
 *
 * A deal starts as an OFFER (either a sponsor proposing through the platform,
 * or a manager recording something agreed offline), moves through negotiation
 * to ACTIVE, and ends DECLINED or EXPIRED.
 */

export const SPONSORSHIP_STATUS_LABELS: Record<SponsorshipStatus, string> = {
  OFFERED: "Offer received",
  NEGOTIATING: "In negotiation",
  ACTIVE: "Active",
  DECLINED: "Declined",
  EXPIRED: "Expired",
};

/** Statuses that represent a deal still in play, needing the team's attention. */
export const OPEN_SPONSORSHIP_STATUSES: SponsorshipStatus[] = [
  SponsorshipStatus.OFFERED,
  SponsorshipStatus.NEGOTIATING,
];

/** Statuses a deal can no longer move out of. */
export const CLOSED_SPONSORSHIP_STATUSES: SponsorshipStatus[] = [
  SponsorshipStatus.DECLINED,
  SponsorshipStatus.EXPIRED,
];

const TRANSITIONS: Record<SponsorshipStatus, SponsorshipStatus[]> = {
  OFFERED: [
    SponsorshipStatus.NEGOTIATING,
    SponsorshipStatus.ACTIVE,
    SponsorshipStatus.DECLINED,
  ],
  NEGOTIATING: [SponsorshipStatus.ACTIVE, SponsorshipStatus.DECLINED],
  ACTIVE: [SponsorshipStatus.EXPIRED, SponsorshipStatus.DECLINED],
  // A closed deal stays closed — re-signing a sponsor is a new record, which
  // keeps the history of what was agreed when.
  DECLINED: [],
  EXPIRED: [],
};

export function canTransitionSponsorship(
  from: SponsorshipStatus,
  to: SponsorshipStatus,
): boolean {
  if (from === to) return false;
  return TRANSITIONS[from].includes(to);
}

export function nextSponsorshipStatuses(
  from: SponsorshipStatus,
): SponsorshipStatus[] {
  return TRANSITIONS[from];
}

export interface SponsorshipRecord {
  status: SponsorshipStatus;
  valueMinor: number | null;
  currency: string;
}

export interface SponsorshipSummary {
  activeCount: number;
  openOfferCount: number;
  /** Total committed value of active deals, per currency. */
  activeValueByCurrency: Record<string, number>;
}

/**
 * Headline numbers for the team dashboard. Values are kept separated by
 * currency rather than summed — a team running in two continents has deals in
 * two currencies, and adding them together would be a lie.
 */
export function summarizeSponsorships(
  records: SponsorshipRecord[],
): SponsorshipSummary {
  const activeValueByCurrency: Record<string, number> = {};
  let activeCount = 0;
  let openOfferCount = 0;

  for (const record of records) {
    if (record.status === SponsorshipStatus.ACTIVE) {
      activeCount += 1;
      if (record.valueMinor !== null && record.valueMinor > 0) {
        const currency = record.currency.toUpperCase();
        activeValueByCurrency[currency] =
          (activeValueByCurrency[currency] ?? 0) + record.valueMinor;
      }
    } else if (OPEN_SPONSORSHIP_STATUSES.includes(record.status)) {
      openOfferCount += 1;
    }
  }

  return { activeCount, openOfferCount, activeValueByCurrency };
}

/** Minor units to a display string, e.g. 1234500 USD -> "$12,345.00". */
export function formatDealValue(
  valueMinor: number | null | undefined,
  currency = "USD",
): string {
  if (valueMinor === null || valueMinor === undefined) return "—";
  const amount = valueMinor / 100;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency.toUpperCase(),
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    // An unrecognized currency code must not break the dashboard.
    return `${amount.toFixed(2)} ${currency.toUpperCase()}`;
  }
}

/** Parses a typed amount ("12,500" or "12500.50") into minor units. */
export function parseDealValue(input: string): number | null {
  const cleaned = input.replace(/[,\s]/g, "");
  if (!cleaned) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}
