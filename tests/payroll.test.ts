import { describe, expect, it } from "vitest";
import { PayBasis, PayRunStatus } from "@prisma/client";
import {
  PAY_RUN_STATUS_LABELS,
  canRecordPayment,
  checkLine,
  describeLine,
  formatMinor,
  isEditable,
  isFullyPaid,
  lineAmountMinor,
  payeeTotals,
  rateOn,
  runTotals,
  toCsv,
} from "@/lib/payroll";
import {
  OFFER_STATUS_LABELS,
  PAY_BASIS_LABELS,
  PAY_BASIS_ORDER,
  PAY_BASIS_UNITS,
  checkOffer,
  describeExpiry,
  describePay,
  hasExpired,
  isLive,
  isSettled,
} from "@/lib/offers";
import { OfferStatus, TeamRole } from "@prisma/client";

describe("pay vocabulary", () => {
  it("labels every basis, unit, offer status and run status", () => {
    for (const basis of Object.values(PayBasis)) {
      expect(PAY_BASIS_LABELS[basis], basis).toBeTruthy();
      expect(PAY_BASIS_UNITS[basis], basis).toBeTruthy();
    }
    for (const status of Object.values(OfferStatus)) {
      expect(OFFER_STATUS_LABELS[status], status).toBeTruthy();
    }
    for (const status of Object.values(PayRunStatus)) {
      expect(PAY_RUN_STATUS_LABELS[status], status).toBeTruthy();
    }
  });

  it("orders every basis exactly once", () => {
    expect([...PAY_BASIS_ORDER].sort()).toEqual(Object.values(PayBasis).sort());
  });
});

describe("describePay", () => {
  it("keeps unpaid, to-be-agreed and zero as three different sentences", () => {
    // Somebody deciding whether to take a job needs to know which of the three
    // they are looking at. "$0.00" for all of them is the bug this prevents.
    expect(describePay({ basis: PayBasis.UNPAID })).toBe("Unpaid");
    expect(describePay({ basis: PayBasis.PER_EVENT, amountMinor: null })).toBe(
      "Per event — rate to be agreed",
    );
    expect(describePay({ basis: PayBasis.PER_EVENT, amountMinor: 0 })).toBe(
      "$0.00 per event",
    );
  });

  it("reads naturally for each basis", () => {
    expect(describePay({ basis: PayBasis.HOURLY, amountMinor: 1800 })).toBe(
      "$18.00 per hour",
    );
    expect(describePay({ basis: PayBasis.SEASON, amountMinor: 500_000 })).toBe(
      "$5,000.00 for the season",
    );
  });

  it("honours the currency", () => {
    expect(
      describePay({
        basis: PayBasis.DAILY,
        amountMinor: 25_000,
        currency: "EUR",
      }),
    ).toContain("€");
  });
});

describe("checkOffer", () => {
  const base = { basis: PayBasis.PER_EVENT, role: TeamRole.CREW };
  const now = new Date("2026-06-01T00:00:00Z");

  it("refuses a figure on an unpaid position", () => {
    const problems = checkOffer(
      { ...base, basis: PayBasis.UNPAID, amountMinor: 5000 },
      now,
    );
    expect(problems.map((problem) => problem.field)).toContain("amount");
  });

  it("allows unpaid with no figure", () => {
    expect(
      checkOffer({ ...base, basis: PayBasis.UNPAID, amountMinor: null }, now),
    ).toEqual([]);
  });

  it("allows a paid basis with the rate still to agree", () => {
    expect(checkOffer({ ...base, amountMinor: null }, now)).toEqual([]);
  });

  it("catches an end date before the start", () => {
    const problems = checkOffer(
      {
        ...base,
        startDate: new Date("2026-08-01"),
        endDate: new Date("2026-07-01"),
      },
      now,
    );
    expect(problems.map((problem) => problem.field)).toContain("dates");
  });

  it("catches an expiry that has already passed", () => {
    // A team fills the form on Monday and sends it the following week — this
    // is the one that actually happens.
    const problems = checkOffer(
      { ...base, expiresAt: new Date("2026-05-01") },
      now,
    );
    expect(problems.map((problem) => problem.field)).toContain("expiry");
  });
});

describe("offer lifecycle", () => {
  it("knows which offers can still be answered", () => {
    expect(isLive(OfferStatus.SENT)).toBe(true);
    expect(isLive(OfferStatus.DRAFT)).toBe(false);
    expect(isSettled(OfferStatus.ACCEPTED)).toBe(true);
    expect(isSettled(OfferStatus.DRAFT)).toBe(false);
  });

  it("expires only a live offer", () => {
    const past = new Date("2026-01-01");
    const now = new Date("2026-06-01");
    expect(hasExpired({ status: OfferStatus.SENT, expiresAt: past }, now)).toBe(
      true,
    );
    // A draft with a stale expiry is not expired — it was never out there.
    expect(
      hasExpired({ status: OfferStatus.DRAFT, expiresAt: past }, now),
    ).toBe(false);
    expect(hasExpired({ status: OfferStatus.SENT }, now)).toBe(false);
  });

  it("counts down in whole days, then hours", () => {
    const now = new Date("2026-06-01T12:00:00Z");
    expect(describeExpiry(new Date("2026-06-04T12:00:00Z"), now)).toBe(
      "3 days left to answer",
    );
    expect(describeExpiry(new Date("2026-06-01T18:00:00Z"), now)).toBe(
      "6 hours left to answer",
    );
    expect(describeExpiry(new Date("2026-05-01"), now)).toBe("Expired");
    expect(describeExpiry(null, now)).toBeNull();
  });
});

describe("lineAmountMinor", () => {
  it("rounds once, at the end", () => {
    // 7.5 hours at £12.33 is one rounding, not two.
    expect(
      lineAmountMinor({
        basis: PayBasis.HOURLY,
        quantity: 7.5,
        rateMinor: 1233,
      }),
    ).toBe(9248);
  });

  it("adds the adjustment after rounding the product", () => {
    expect(
      lineAmountMinor({
        basis: PayBasis.PER_EVENT,
        quantity: 2,
        rateMinor: 15_000,
        adjustmentMinor: 5000,
      }),
    ).toBe(35_000);
  });

  it("is zero for unpaid whatever is left in the boxes", () => {
    // The basis is the statement of fact; the numbers behind it are leftovers
    // from before somebody changed it.
    expect(
      lineAmountMinor({
        basis: PayBasis.UNPAID,
        quantity: 10,
        rateMinor: 5000,
      }),
    ).toBe(0);
  });

  it("handles a negative adjustment", () => {
    expect(
      lineAmountMinor({
        basis: PayBasis.DAILY,
        quantity: 3,
        rateMinor: 10_000,
        adjustmentMinor: -2500,
      }),
    ).toBe(27_500);
  });
});

describe("checkLine", () => {
  it("refuses a deduction bigger than the pay", () => {
    // That means the person owes the team, which this model does not
    // represent and must not silently become a negative payment.
    const problem = checkLine({
      basis: PayBasis.DAILY,
      quantity: 1,
      rateMinor: 10_000,
      adjustmentMinor: -15_000,
    });
    expect(problem?.reason).toBe("negative-total");
  });

  it("refuses negative quantities and rates", () => {
    expect(
      checkLine({ basis: PayBasis.HOURLY, quantity: -1, rateMinor: 100 })
        ?.reason,
    ).toBe("quantity");
    expect(
      checkLine({ basis: PayBasis.HOURLY, quantity: 1, rateMinor: -100 })
        ?.reason,
    ).toBe("rate");
  });

  it("accepts an ordinary line", () => {
    expect(
      checkLine({ basis: PayBasis.PER_EVENT, quantity: 1, rateMinor: 25_000 }),
    ).toBeNull();
  });
});

describe("runTotals", () => {
  const lines = [
    { currency: "USD", amountMinor: 30_000, paidAt: new Date() },
    { currency: "USD", amountMinor: 20_000, paidAt: null },
    { currency: "EUR", amountMinor: 15_000, paidAt: null },
  ];

  it("never adds currencies together", () => {
    // One combined figure would be a made-up amount in a made-up currency, on
    // a document somebody pays people from.
    const totals = runTotals(lines);
    expect(totals).toEqual([
      {
        currency: "USD",
        grossMinor: 50_000,
        paidMinor: 30_000,
        outstandingMinor: 20_000,
      },
      {
        currency: "EUR",
        grossMinor: 15_000,
        paidMinor: 0,
        outstandingMinor: 15_000,
      },
    ]);
  });

  it("is empty for an empty run", () => {
    expect(runTotals([])).toEqual([]);
  });
});

describe("payeeTotals", () => {
  it("keys on person and currency together", () => {
    // Somebody on a dollar retainer and a euro per-event fee is two payments,
    // not one row that has to pick a currency.
    const totals = payeeTotals([
      { userId: "u1", currency: "USD", amountMinor: 10_000, paidAt: null },
      { userId: "u1", currency: "EUR", amountMinor: 8000, paidAt: null },
      { userId: "u1", currency: "USD", amountMinor: 5000, paidAt: new Date() },
    ]);
    expect(totals).toHaveLength(2);
    const usd = totals.find((row) => row.currency === "USD")!;
    expect(usd.grossMinor).toBe(15_000);
    expect(usd.outstandingMinor).toBe(10_000);
  });

  it("keeps an off-platform payee separate from an account", () => {
    const totals = payeeTotals([
      { userId: "u1", currency: "USD", amountMinor: 100, paidAt: null },
      { payeeName: "Weekend mechanic", currency: "USD", amountMinor: 200, paidAt: null },
    ]);
    expect(totals).toHaveLength(2);
  });
});

describe("isFullyPaid", () => {
  it("is true only when every line is marked", () => {
    expect(
      isFullyPaid([
        { currency: "USD", amountMinor: 1, paidAt: new Date() },
        { currency: "USD", amountMinor: 1, paidAt: null },
      ]),
    ).toBe(false);
    expect(
      isFullyPaid([{ currency: "USD", amountMinor: 1, paidAt: new Date() }]),
    ).toBe(true);
  });

  it("is false for an empty run rather than vacuously true", () => {
    // An empty run is not a paid run, and marking it so would close it off
    // before anybody had been paid anything.
    expect(isFullyPaid([])).toBe(false);
  });
});

describe("run status gates", () => {
  it("lets figures change only while it is a draft", () => {
    expect(isEditable(PayRunStatus.DRAFT)).toBe(true);
    expect(isEditable(PayRunStatus.APPROVED)).toBe(false);
  });

  it("lets payments be recorded only once approved", () => {
    // Marking a draft line paid would let money go out against a figure nobody
    // signed off, which is the one thing an approval step exists to prevent.
    expect(canRecordPayment(PayRunStatus.DRAFT)).toBe(false);
    expect(canRecordPayment(PayRunStatus.APPROVED)).toBe(true);
    expect(canRecordPayment(PayRunStatus.PAID)).toBe(true);
  });
});

describe("rateOn", () => {
  const rates = [
    {
      id: "old",
      basis: PayBasis.PER_EVENT,
      amountMinor: 20_000,
      currency: "USD",
      effectiveFrom: new Date("2026-01-01"),
      effectiveTo: new Date("2026-06-30"),
    },
    {
      id: "new",
      basis: PayBasis.PER_EVENT,
      amountMinor: 25_000,
      currency: "USD",
      effectiveFrom: new Date("2026-07-01"),
      effectiveTo: null,
    },
  ];

  it("uses the rate in force on the day, not today's", () => {
    // A pay run for March must use March's rate even if it is built in
    // December — which is why superseded rates are kept.
    expect(rateOn(rates, new Date("2026-03-15"))?.id).toBe("old");
    expect(rateOn(rates, new Date("2026-09-15"))?.id).toBe("new");
  });

  it("is null before any rate existed", () => {
    expect(rateOn(rates, new Date("2025-06-01"))).toBeNull();
  });

  it("prefers the most recently started when two overlap", () => {
    const overlapping = [
      { ...rates[0]!, id: "a", effectiveTo: null },
      { ...rates[1]!, id: "b", effectiveFrom: new Date("2026-03-01") },
    ];
    expect(rateOn(overlapping, new Date("2026-04-01"))?.id).toBe("b");
  });
});

describe("describeLine", () => {
  it("shows how the figure was arrived at", () => {
    expect(
      describeLine({
        basis: PayBasis.HOURLY,
        quantity: 12,
        rateMinor: 1800,
        currency: "USD",
      }),
    ).toBe("12 hours at $18.00");
  });

  it("does not print a rate for unpaid work", () => {
    expect(
      describeLine({
        basis: PayBasis.UNPAID,
        quantity: 1,
        rateMinor: 0,
        currency: "USD",
      }),
    ).toBe("Unpaid");
  });
});

describe("toCsv", () => {
  const line = {
    payeeName: "Dani",
    description: "Race engineer",
    basis: PayBasis.PER_EVENT,
    quantity: 2,
    rateMinor: 25_000,
    adjustmentMinor: 0,
    amountMinor: 50_000,
    currency: "USD",
    paidAt: null,
    paymentReference: null,
  };

  it("writes major units for the systems that read it", () => {
    const csv = toCsv([line]);
    expect(csv.split("\n")[1]).toContain("250.00");
    expect(csv.split("\n")[1]).toContain("500.00");
  });

  it("quotes a payee with a comma in their name", () => {
    // Otherwise every column after it shifts by one, and the amount lands in
    // the currency column of somebody's bank import.
    const csv = toCsv([{ ...line, payeeName: "Smith, John" }]);
    expect(csv).toContain('"Smith, John"');
    expect(csv.split("\n")[1]!.split('"')[2]!.split(",").length).toBe(10);
  });

  it("escapes embedded quotes by doubling them", () => {
    const csv = toCsv([{ ...line, description: 'The "quick" one' }]);
    expect(csv).toContain('"The ""quick"" one"');
  });

  it("neutralises a formula, because an accountant opens this in Excel", () => {
    // A cell starting =, +, - or @ is executed on open, and a payee name is
    // attacker-controlled text.
    const csv = toCsv([{ ...line, payeeName: "=1+1" }]);
    expect(csv).toContain("'=1+1");
    expect(csv).not.toMatch(/,=1\+1/);
  });

  it("keeps a header row", () => {
    expect(toCsv([]).split("\n")[0]).toContain("Payee");
  });
});

describe("formatMinor", () => {
  it("reads minor units and never a float", () => {
    expect(formatMinor(123_456)).toBe("$1,234.56");
    expect(formatMinor(0)).toBe("$0.00");
    expect(formatMinor(2500, "EUR")).toContain("25.00");
  });
});
