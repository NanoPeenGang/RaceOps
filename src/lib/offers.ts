import { OfferStatus, PayBasis, TeamRole } from "@prisma/client";

/**
 * Offers, and the money on them.
 *
 * The one rule everything here follows: **an unpaid position carries no
 * figure, not a zero.** Most club crew are volunteers and a great many seats
 * are paid by the driver rather than to them, so a form that insists on a
 * number has people typing 0 into a field the platform then treats as a wage.
 * A payroll built on that pays people nothing while looking entirely correct.
 * `UNPAID` and `null` are the two honest ways to say "no money here", and they
 * mean different things: no money agreed, versus money not agreed yet.
 */

export const PAY_BASIS_LABELS: Record<PayBasis, string> = {
  HOURLY: "Per hour",
  DAILY: "Per day",
  PER_EVENT: "Per event",
  MONTHLY: "Per month",
  SEASON: "For the season",
  UNPAID: "Unpaid",
};

/** What the quantity on a payroll line counts, for each basis. */
export const PAY_BASIS_UNITS: Record<PayBasis, string> = {
  HOURLY: "hours",
  DAILY: "days",
  PER_EVENT: "events",
  MONTHLY: "months",
  SEASON: "seasons",
  UNPAID: "—",
};

export const PAY_BASIS_ORDER: readonly PayBasis[] = [
  PayBasis.PER_EVENT,
  PayBasis.DAILY,
  PayBasis.HOURLY,
  PayBasis.MONTHLY,
  PayBasis.SEASON,
  PayBasis.UNPAID,
];

export const OFFER_STATUS_LABELS: Record<OfferStatus, string> = {
  DRAFT: "Draft",
  SENT: "Waiting on them",
  ACCEPTED: "Accepted",
  DECLINED: "Declined",
  WITHDRAWN: "Withdrawn",
  EXPIRED: "Expired",
};

/** An offer that is still capable of being answered. */
export function isLive(status: OfferStatus): boolean {
  return status === OfferStatus.SENT;
}

/** An offer nobody will act on again. */
export function isSettled(status: OfferStatus): boolean {
  return (
    status === OfferStatus.ACCEPTED ||
    status === OfferStatus.DECLINED ||
    status === OfferStatus.WITHDRAWN ||
    status === OfferStatus.EXPIRED
  );
}

export interface OfferTerms {
  basis: PayBasis;
  amountMinor?: number | null;
  currency?: string | null;
  role: TeamRole;
  expiresAt?: Date | string | null;
  startDate?: Date | string | null;
  endDate?: Date | string | null;
}

export type OfferProblem =
  | { field: "amount"; message: string }
  | { field: "dates"; message: string }
  | { field: "expiry"; message: string };

/**
 * Everything wrong with an offer, before it goes out.
 *
 * Checked here as well as by the database, so a team gets a sentence in the
 * form rather than a constraint violation after pressing send. An offer is
 * read by somebody deciding whether to move house for it; the numbers on it
 * being coherent is not a nicety.
 */
export function checkOffer(
  terms: OfferTerms,
  now: Date = new Date(),
): OfferProblem[] {
  const problems: OfferProblem[] = [];

  if (terms.basis === PayBasis.UNPAID && terms.amountMinor != null) {
    problems.push({
      field: "amount",
      message:
        "An unpaid position carries no figure. Pick a basis, or clear the amount.",
    });
  }
  if (terms.amountMinor != null && terms.amountMinor < 0) {
    problems.push({ field: "amount", message: "The amount cannot be negative." });
  }

  if (terms.startDate && terms.endDate) {
    const start = new Date(terms.startDate).getTime();
    const end = new Date(terms.endDate).getTime();
    if (end < start) {
      problems.push({
        field: "dates",
        message: "The end date is before the start date.",
      });
    }
  }

  if (terms.expiresAt) {
    const expires = new Date(terms.expiresAt).getTime();
    if (expires <= now.getTime()) {
      problems.push({
        field: "expiry",
        message: "That expiry has already passed — they could not answer it.",
      });
    }
  }

  return problems;
}

/** Whether a live offer has run past its own expiry. */
export function hasExpired(
  offer: { status: OfferStatus; expiresAt?: Date | string | null },
  now: Date = new Date(),
): boolean {
  if (!isLive(offer.status)) return false;
  if (!offer.expiresAt) return false;
  return new Date(offer.expiresAt).getTime() <= now.getTime();
}

/**
 * The pay line on an offer, as a person reads it.
 *
 * "Unpaid" and "Rate to be agreed" are different sentences on purpose, and
 * neither is "$0.00". Somebody deciding whether to take a job needs to know
 * which of the three they are looking at.
 */
export function describePay(terms: {
  basis: PayBasis;
  amountMinor?: number | null;
  currency?: string | null;
}): string {
  if (terms.basis === PayBasis.UNPAID) return "Unpaid";
  if (terms.amountMinor == null) {
    return `${PAY_BASIS_LABELS[terms.basis]} — rate to be agreed`;
  }
  const money = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: terms.currency ?? "USD",
  }).format(terms.amountMinor / 100);

  switch (terms.basis) {
    case PayBasis.HOURLY:
      return `${money} per hour`;
    case PayBasis.DAILY:
      return `${money} per day`;
    case PayBasis.PER_EVENT:
      return `${money} per event`;
    case PayBasis.MONTHLY:
      return `${money} per month`;
    case PayBasis.SEASON:
      return `${money} for the season`;
    default:
      return money;
  }
}

/** "3 days left to answer", "Expired" — the line on a live offer. */
export function describeExpiry(
  expiresAt: Date | string | null | undefined,
  now: Date = new Date(),
): string | null {
  if (!expiresAt) return null;
  const remaining = new Date(expiresAt).getTime() - now.getTime();
  if (remaining <= 0) return "Expired";

  const days = Math.floor(remaining / 86_400_000);
  if (days >= 1) return `${days} day${days === 1 ? "" : "s"} left to answer`;
  const hours = Math.max(1, Math.floor(remaining / 3_600_000));
  return `${hours} hour${hours === 1 ? "" : "s"} left to answer`;
}
