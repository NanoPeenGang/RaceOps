import { describe, expect, it } from "vitest";
import { SponsorshipStatus } from "@prisma/client";
import {
  SPONSORSHIP_STATUS_LABELS,
  canTransitionSponsorship,
  formatDealValue,
  nextSponsorshipStatuses,
  parseDealValue,
  summarizeSponsorships,
} from "@/lib/sponsorship";

describe("SPONSORSHIP_STATUS_LABELS", () => {
  it("labels every status", () => {
    for (const status of Object.values(SponsorshipStatus)) {
      expect(SPONSORSHIP_STATUS_LABELS[status], status).toBeTruthy();
    }
  });
});

describe("canTransitionSponsorship", () => {
  it("walks an offer through to active", () => {
    expect(
      canTransitionSponsorship(
        SponsorshipStatus.OFFERED,
        SponsorshipStatus.NEGOTIATING,
      ),
    ).toBe(true);
    expect(
      canTransitionSponsorship(
        SponsorshipStatus.NEGOTIATING,
        SponsorshipStatus.ACTIVE,
      ),
    ).toBe(true);
  });

  it("allows accepting an offer outright", () => {
    expect(
      canTransitionSponsorship(
        SponsorshipStatus.OFFERED,
        SponsorshipStatus.ACTIVE,
      ),
    ).toBe(true);
  });

  it("keeps closed deals closed", () => {
    for (const closed of [
      SponsorshipStatus.DECLINED,
      SponsorshipStatus.EXPIRED,
    ]) {
      for (const target of Object.values(SponsorshipStatus)) {
        expect(canTransitionSponsorship(closed, target), `${closed}->${target}`).toBe(
          false,
        );
      }
    }
  });

  it("refuses a no-op transition", () => {
    expect(
      canTransitionSponsorship(
        SponsorshipStatus.ACTIVE,
        SponsorshipStatus.ACTIVE,
      ),
    ).toBe(false);
  });

  it("will not reopen an active deal back into negotiation", () => {
    expect(
      canTransitionSponsorship(
        SponsorshipStatus.ACTIVE,
        SponsorshipStatus.NEGOTIATING,
      ),
    ).toBe(false);
  });

  it("agrees with nextSponsorshipStatuses", () => {
    for (const from of Object.values(SponsorshipStatus)) {
      for (const to of Object.values(SponsorshipStatus)) {
        expect(canTransitionSponsorship(from, to)).toBe(
          nextSponsorshipStatuses(from).includes(to),
        );
      }
    }
  });
});

describe("summarizeSponsorships", () => {
  it("counts active deals and open offers separately", () => {
    const summary = summarizeSponsorships([
      { status: SponsorshipStatus.ACTIVE, valueMinor: 500000, currency: "USD" },
      { status: SponsorshipStatus.ACTIVE, valueMinor: 250000, currency: "USD" },
      { status: SponsorshipStatus.OFFERED, valueMinor: 100000, currency: "USD" },
      {
        status: SponsorshipStatus.NEGOTIATING,
        valueMinor: null,
        currency: "USD",
      },
      { status: SponsorshipStatus.DECLINED, valueMinor: 900000, currency: "USD" },
    ]);
    expect(summary.activeCount).toBe(2);
    expect(summary.openOfferCount).toBe(2);
    // Only active deals count toward committed value.
    expect(summary.activeValueByCurrency).toEqual({ USD: 750000 });
  });

  it("keeps currencies apart rather than summing them", () => {
    const summary = summarizeSponsorships([
      { status: SponsorshipStatus.ACTIVE, valueMinor: 100000, currency: "USD" },
      { status: SponsorshipStatus.ACTIVE, valueMinor: 200000, currency: "eur" },
    ]);
    expect(summary.activeValueByCurrency).toEqual({ USD: 100000, EUR: 200000 });
  });

  it("ignores missing and zero values", () => {
    const summary = summarizeSponsorships([
      { status: SponsorshipStatus.ACTIVE, valueMinor: null, currency: "USD" },
      { status: SponsorshipStatus.ACTIVE, valueMinor: 0, currency: "USD" },
    ]);
    expect(summary.activeCount).toBe(2);
    expect(summary.activeValueByCurrency).toEqual({});
  });

  it("is empty for no deals", () => {
    expect(summarizeSponsorships([])).toEqual({
      activeCount: 0,
      openOfferCount: 0,
      activeValueByCurrency: {},
    });
  });
});

describe("deal value parsing and formatting", () => {
  it("parses plain and grouped amounts into minor units", () => {
    expect(parseDealValue("12500")).toBe(1250000);
    expect(parseDealValue("12,500")).toBe(1250000);
    expect(parseDealValue("12500.50")).toBe(1250050);
    expect(parseDealValue(" 250 ")).toBe(25000);
  });

  it("rejects junk rather than guessing", () => {
    expect(parseDealValue("")).toBeNull();
    expect(parseDealValue("lots")).toBeNull();
    expect(parseDealValue("-500")).toBeNull();
    // More precision than a currency's minor unit is a typo, not a value.
    expect(parseDealValue("100.005")).toBeNull();
  });

  it("round-trips through formatting", () => {
    const minor = parseDealValue("12,500.75")!;
    expect(formatDealValue(minor, "USD")).toContain("12,500.75");
  });

  it("shows a dash for no value", () => {
    expect(formatDealValue(null)).toBe("—");
    expect(formatDealValue(undefined)).toBe("—");
  });

  it("degrades gracefully for an unknown currency code", () => {
    // Must not throw — a bad code should never break the dashboard.
    expect(formatDealValue(150000, "XYZZY")).toBe("1500.00 XYZZY");
  });
});
