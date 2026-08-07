import { describe, expect, it } from "vitest";
import { SponsorshipStatus } from "@prisma/client";
import {
  daysUntilEnd,
  daysWaiting,
  isStaleOffer,
  isUpForRenewal,
  RENEWAL_WINDOW_DAYS,
  sortSponsorDeals,
  SPONSOR_STATUS_LABELS,
  STALE_OFFER_DAYS,
  summarizeSponsorPortfolio,
  type SponsorDeal,
} from "@/lib/sponsor-dashboard";

/**
 * A sponsor's book, read from the sponsor's end.
 *
 * The distinction this file is really guarding: money *offered* is not money
 * *spent*. A dashboard that adds an unanswered offer to committed spend tells
 * a sponsor they have paid for something no team has agreed to.
 */

const deal = (over: Partial<SponsorDeal> = {}): SponsorDeal => ({
  status: SponsorshipStatus.ACTIVE,
  valueMinor: 500_000,
  currency: "USD",
  startDate: null,
  endDate: null,
  teamId: "team_a",
  ...over,
});

describe("the portfolio totals", () => {
  it("counts live spend and leaves offers out of it", () => {
    const totals = summarizeSponsorPortfolio([
      deal({ valueMinor: 250_000 }),
      deal({ status: SponsorshipStatus.OFFERED, valueMinor: 1_000_000 }),
    ]);
    expect(totals.liveSpendByCurrency.USD).toBe(250_000);
    expect(totals.pendingValueByCurrency.USD).toBe(1_000_000);
  });

  it("keeps currencies apart rather than adding them", () => {
    // Summing these needs an exchange rate, and inventing one puts a wrong
    // number on somebody's budget.
    const totals = summarizeSponsorPortfolio([
      deal({ valueMinor: 100_000, currency: "USD" }),
      deal({ valueMinor: 100_000, currency: "GBP" }),
    ]);
    expect(totals.liveSpendByCurrency).toEqual({ USD: 100_000, GBP: 100_000 });
  });

  it("normalises the currency code", () => {
    const totals = summarizeSponsorPortfolio([
      deal({ valueMinor: 1, currency: "usd" }),
      deal({ valueMinor: 2, currency: "USD" }),
    ]);
    expect(totals.liveSpendByCurrency).toEqual({ USD: 3 });
  });

  it("counts a team once however many deals it holds", () => {
    const totals = summarizeSponsorPortfolio([
      deal({ teamId: "team_a" }),
      deal({ teamId: "team_a", status: SponsorshipStatus.EXPIRED }),
      deal({ teamId: "team_b" }),
    ]);
    expect(totals.liveTeamCount).toBe(2);
    expect(totals.teamsApproached).toBe(2);
  });

  it("counts a team approached but not backed", () => {
    const totals = summarizeSponsorPortfolio([
      deal({ teamId: "team_a" }),
      deal({ teamId: "team_b", status: SponsorshipStatus.DECLINED }),
    ]);
    expect(totals.liveTeamCount).toBe(1);
    expect(totals.teamsApproached).toBe(2);
  });

  it("ignores a deal with no value on it rather than counting it as zero", () => {
    const totals = summarizeSponsorPortfolio([deal({ valueMinor: null })]);
    expect(totals.byStatus.ACTIVE).toBe(1);
    expect(totals.liveSpendByCurrency).toEqual({});
  });

  it("reports every status, including the ones at zero", () => {
    const totals = summarizeSponsorPortfolio([]);
    expect(totals.total).toBe(0);
    for (const status of Object.values(SponsorshipStatus)) {
      expect(totals.byStatus[status]).toBe(0);
    }
  });
});

describe("what needs the sponsor's attention", () => {
  const now = new Date("2026-06-01T00:00:00Z");

  it("flags an offer nobody has picked up", () => {
    const old = new Date(now.getTime() - STALE_OFFER_DAYS * 86_400_000);
    expect(
      isStaleOffer({ status: SponsorshipStatus.OFFERED, createdAt: old }, now),
    ).toBe(true);
  });

  it("leaves a recent offer alone", () => {
    const recent = new Date(now.getTime() - 2 * 86_400_000);
    expect(
      isStaleOffer(
        { status: SponsorshipStatus.OFFERED, createdAt: recent },
        now,
      ),
    ).toBe(false);
  });

  it("does not flag a deal the team has already opened talks on", () => {
    const old = new Date(now.getTime() - 90 * 86_400_000);
    expect(
      isStaleOffer(
        { status: SponsorshipStatus.NEGOTIATING, createdAt: old },
        now,
      ),
    ).toBe(false);
  });

  it("flags a live deal inside the renewal window", () => {
    const soon = new Date(now.getTime() + 10 * 86_400_000);
    expect(
      isUpForRenewal({ status: SponsorshipStatus.ACTIVE, endDate: soon }, now),
    ).toBe(true);
    expect(daysUntilEnd(soon, now)).toBe(10);
  });

  it("does not flag one that ends well beyond the window", () => {
    const later = new Date(
      now.getTime() + (RENEWAL_WINDOW_DAYS + 30) * 86_400_000,
    );
    expect(
      isUpForRenewal({ status: SponsorshipStatus.ACTIVE, endDate: later }, now),
    ).toBe(false);
  });

  it("never flags an open-ended deal", () => {
    // An agreement with no end date is not expiring, and warning about one
    // every day forever is how a dashboard trains people to ignore it.
    expect(
      isUpForRenewal({ status: SponsorshipStatus.ACTIVE, endDate: null }, now),
    ).toBe(false);
  });

  it("flags a live deal that has already lapsed", () => {
    const past = new Date(now.getTime() - 5 * 86_400_000);
    expect(
      isUpForRenewal({ status: SponsorshipStatus.ACTIVE, endDate: past }, now),
    ).toBe(true);
  });

  it("does not warn about renewing something that already ended", () => {
    const past = new Date(now.getTime() - 5 * 86_400_000);
    expect(
      isUpForRenewal({ status: SponsorshipStatus.EXPIRED, endDate: past }, now),
    ).toBe(false);
  });

  it("never reports a negative wait", () => {
    const future = new Date(now.getTime() + 86_400_000);
    expect(daysWaiting(future, now)).toBe(0);
  });
});

describe("the order deals are read in", () => {
  it("puts what the sponsor can act on first, newest inside that", () => {
    const sorted = sortSponsorDeals([
      {
        id: "declined",
        status: SponsorshipStatus.DECLINED,
        createdAt: new Date("2026-05-01"),
      },
      {
        id: "offered-old",
        status: SponsorshipStatus.OFFERED,
        createdAt: new Date("2026-01-01"),
      },
      {
        id: "active",
        status: SponsorshipStatus.ACTIVE,
        createdAt: new Date("2026-04-01"),
      },
      {
        id: "offered-new",
        status: SponsorshipStatus.OFFERED,
        createdAt: new Date("2026-03-01"),
      },
    ]);
    expect(sorted.map((d) => d.id)).toEqual([
      "offered-new",
      "offered-old",
      "active",
      "declined",
    ]);
  });

  it("does not mutate the array it was given", () => {
    const input = [
      {
        status: SponsorshipStatus.DECLINED,
        createdAt: new Date("2026-01-01"),
      },
      { status: SponsorshipStatus.OFFERED, createdAt: new Date("2026-02-01") },
    ];
    const before = [...input];
    sortSponsorDeals(input);
    expect(input).toEqual(before);
  });
});

describe("the labels", () => {
  it("reads from the sponsor's side, not the team's", () => {
    // The same row means different things at each end: to a team an OFFERED
    // deal is work arriving; to a sponsor it is waiting on a reply.
    expect(SPONSOR_STATUS_LABELS.OFFERED).toBe("Awaiting reply");
    for (const status of Object.values(SponsorshipStatus)) {
      expect(SPONSOR_STATUS_LABELS[status]).toBeTruthy();
    }
  });
});
