import { describe, expect, it } from "vitest";
import { InvoiceStatus } from "@prisma/client";
import {
  canRecordPayment,
  canVoid,
  checkLine,
  daysOverdue,
  defaultDueDate,
  formatInvoiceNumber,
  formatMoney,
  formatTaxRate,
  invoiceTotals,
  isEditable,
  isOverdue,
  lineAmountMinor,
  parseAmount,
  parseTaxRate,
  settlementLabel,
  settlementOf,
} from "@/lib/invoices";

/**
 * Billing third-party work.
 *
 * Two things here are worth more than the rest. Rounding, because an invoice a
 * penny away from the quote is an invoice that gets queried and then paid
 * late. And settlement, because it is derived from the payments rather than
 * stored — a "paid" flag that disagrees with the money recorded against it is
 * the discrepancy nobody finds until year end.
 */

describe("what a line comes to", () => {
  it("rounds once, on the product", () => {
    // 7.5 hours at £82.50. Rounding the rate first and the total second is how
    // an invoice ends up a penny off the quote somebody was given.
    expect(lineAmountMinor({ quantity: 7.5, unitMinor: 8250 })).toBe(61875);
  });

  it("handles a rate that does not divide cleanly", () => {
    expect(lineAmountMinor({ quantity: 3, unitMinor: 3333 })).toBe(9999);
    expect(lineAmountMinor({ quantity: 1 / 3, unitMinor: 1000 })).toBe(333);
  });

  it("takes a negative rate, which is how a discount is written", () => {
    // A negative *quantity* would print as "-1 x labour"; a negative rate
    // prints as a discount line the customer can read.
    expect(lineAmountMinor({ quantity: 1, unitMinor: -5000 })).toBe(-5000);
  });

  it("returns zero rather than NaN for rubbish", () => {
    expect(lineAmountMinor({ quantity: Number.NaN, unitMinor: 100 })).toBe(0);
    expect(lineAmountMinor({ quantity: 1, unitMinor: Number.NaN })).toBe(0);
  });
});

describe("what a line has to have", () => {
  it("wants a description, because it is what the customer reads", () => {
    expect(
      checkLine({ description: "  ", quantity: 1, unitMinor: 100 })?.field,
    ).toBe("description");
  });

  it("refuses a quantity of zero or less", () => {
    for (const quantity of [0, -1]) {
      expect(
        checkLine({ description: "Labour", quantity, unitMinor: 100 })?.field,
      ).toBe("quantity");
    }
  });

  it("accepts an ordinary line", () => {
    expect(
      checkLine({ description: "Gearbox rebuild", quantity: 1, unitMinor: 90000 }),
    ).toBeNull();
  });
});

describe("the foot of the invoice", () => {
  const lines = [
    { amountMinor: 90000, taxable: true },
    { amountMinor: 12500, taxable: true },
    { amountMinor: 4000, taxable: false },
  ];

  it("taxes only what the flag says", () => {
    const totals = invoiceTotals(lines, 2000);
    expect(totals.subtotalMinor).toBe(106500);
    expect(totals.taxableMinor).toBe(102500);
    expect(totals.taxMinor).toBe(20500);
    expect(totals.totalMinor).toBe(127000);
  });

  it("works the tax out on the subtotal, not line by line", () => {
    /*
     * The customer's first move is to apply the rate to the total themselves.
     * Rounding per line and summing drifts from that figure, and the drift is
     * exactly what gets queried.
     */
    const awkward = [
      { amountMinor: 333, taxable: true },
      { amountMinor: 333, taxable: true },
      { amountMinor: 333, taxable: true },
    ];
    const perLine = awkward.reduce(
      (sum, line) => sum + Math.round((line.amountMinor * 1750) / 10_000),
      0,
    );
    expect(invoiceTotals(awkward, 1750).taxMinor).toBe(175);
    expect(perLine).toBe(174);
  });

  it("charges nothing at a zero rate", () => {
    const totals = invoiceTotals(lines, 0);
    expect(totals.taxMinor).toBe(0);
    expect(totals.totalMinor).toBe(totals.subtotalMinor);
  });

  it("carries a discount line straight through", () => {
    const totals = invoiceTotals(
      [
        { amountMinor: 10000, taxable: true },
        { amountMinor: -1000, taxable: true },
      ],
      2000,
    );
    expect(totals.subtotalMinor).toBe(9000);
    expect(totals.taxMinor).toBe(1800);
  });

  it("is zero for an empty invoice rather than undefined", () => {
    expect(invoiceTotals([], 2000)).toEqual({
      subtotalMinor: 0,
      taxableMinor: 0,
      taxMinor: 0,
      totalMinor: 0,
    });
  });
});

describe("what is still owed", () => {
  it("counts a deposit as part paid, not unpaid", () => {
    // The normal shape of a large fabrication job, and a boolean cannot say
    // "half".
    const settlement = settlementOf(100000, [{ amountMinor: 30000 }]);
    expect(settlement.paidMinor).toBe(30000);
    expect(settlement.outstandingMinor).toBe(70000);
    expect(settlement.partial).toBe(true);
    expect(settlement.settled).toBe(false);
  });

  it("settles when the payments meet the total", () => {
    const settlement = settlementOf(100000, [
      { amountMinor: 30000 },
      { amountMinor: 70000 },
    ]);
    expect(settlement.settled).toBe(true);
    expect(settlement.outstandingMinor).toBe(0);
    expect(settlement.partial).toBe(false);
  });

  it("surfaces an overpayment rather than hiding it", () => {
    const settlement = settlementOf(100000, [{ amountMinor: 120000 }]);
    expect(settlement.settled).toBe(true);
    expect(settlement.overpaidMinor).toBe(20000);
    // Never negative: "you are owed minus £200" is not a sentence.
    expect(settlement.outstandingMinor).toBe(0);
  });

  it("does not call a zero-total invoice settled", () => {
    // An empty draft has nothing paid against it and nothing owed; calling it
    // paid would put it in the wrong list.
    expect(settlementOf(0, []).settled).toBe(false);
  });

  it("folds settlement into the status people read", () => {
    const unpaid = settlementOf(100000, []);
    expect(settlementLabel(InvoiceStatus.ISSUED, unpaid)).toBe(
      "Awaiting payment",
    );
    expect(
      settlementLabel(InvoiceStatus.ISSUED, settlementOf(100000, [{ amountMinor: 100000 }])),
    ).toBe("Paid");
    expect(
      settlementLabel(InvoiceStatus.ISSUED, settlementOf(100000, [{ amountMinor: 1 }])),
    ).toBe("Part paid");
    // A void invoice is void whatever was paid against it.
    expect(settlementLabel(InvoiceStatus.VOID, unpaid)).toBe("Void");
    expect(settlementLabel(InvoiceStatus.DRAFT, unpaid)).toBe("Draft");
  });
});

describe("the lifecycle", () => {
  it("only lets a draft be edited", () => {
    expect(isEditable(InvoiceStatus.DRAFT)).toBe(true);
    expect(isEditable(InvoiceStatus.ISSUED)).toBe(false);
    expect(isEditable(InvoiceStatus.VOID)).toBe(false);
  });

  it("only records money against something actually sent", () => {
    expect(canRecordPayment(InvoiceStatus.ISSUED)).toBe(true);
    expect(canRecordPayment(InvoiceStatus.DRAFT)).toBe(false);
    expect(canRecordPayment(InvoiceStatus.VOID)).toBe(false);
  });

  it("only voids what is in circulation", () => {
    // A draft is deleted; there is no number to preserve.
    expect(canVoid(InvoiceStatus.ISSUED)).toBe(true);
    expect(canVoid(InvoiceStatus.DRAFT)).toBe(false);
    expect(canVoid(InvoiceStatus.VOID)).toBe(false);
  });
});

describe("chasing", () => {
  const now = new Date("2026-06-01T00:00:00Z");
  const past = new Date("2026-05-01T00:00:00Z");
  const future = new Date("2026-07-01T00:00:00Z");

  it("flags an issued invoice past its date with money on it", () => {
    const settlement = settlementOf(100000, []);
    expect(
      isOverdue({ status: InvoiceStatus.ISSUED, dueOn: past }, settlement, now),
    ).toBe(true);
    expect(daysOverdue(past, now)).toBe(31);
  });

  it("does not flag one that was paid late", () => {
    // Paid late is finished, not overdue. Listing it would make the chase list
    // something people stop reading.
    const settled = settlementOf(100000, [{ amountMinor: 100000 }]);
    expect(
      isOverdue({ status: InvoiceStatus.ISSUED, dueOn: past }, settled, now),
    ).toBe(false);
  });

  it("still flags a part-paid invoice past its date", () => {
    const partial = settlementOf(100000, [{ amountMinor: 30000 }]);
    expect(
      isOverdue({ status: InvoiceStatus.ISSUED, dueOn: past }, partial, now),
    ).toBe(true);
  });

  it("does not flag one that is not due yet", () => {
    expect(
      isOverdue(
        { status: InvoiceStatus.ISSUED, dueOn: future },
        settlementOf(100000, []),
        now,
      ),
    ).toBe(false);
  });

  it("never flags a draft or a void", () => {
    const settlement = settlementOf(100000, []);
    for (const status of [InvoiceStatus.DRAFT, InvoiceStatus.VOID]) {
      expect(isOverdue({ status, dueOn: past }, settlement, now)).toBe(false);
    }
  });

  it("says nothing about an invoice with no date on it", () => {
    expect(
      isOverdue(
        { status: InvoiceStatus.ISSUED, dueOn: null },
        settlementOf(100000, []),
        now,
      ),
    ).toBe(false);
  });

  it("defaults to the window a customer's accounts department assumes", () => {
    expect(defaultDueDate(new Date("2026-06-01T00:00:00Z")).toISOString()).toBe(
      new Date("2026-07-01T00:00:00Z").toISOString(),
    );
  });
});

describe("how it reads", () => {
  it("pads the number so a run sorts and pastes cleanly", () => {
    expect(formatInvoiceNumber(7)).toBe("INV-0007");
    expect(formatInvoiceNumber(1234)).toBe("INV-1234");
    expect(formatInvoiceNumber(12345)).toBe("INV-12345");
  });

  it("calls an unissued invoice a draft rather than INV-0000", () => {
    expect(formatInvoiceNumber(null)).toBe("Draft");
  });

  it("prints a tax rate without a float", () => {
    expect(formatTaxRate(2000)).toBe("20%");
    expect(formatTaxRate(1750)).toBe("17.5%");
    expect(formatTaxRate(0)).toBe("0%");
  });

  it("survives a currency code it does not recognise", () => {
    // An invoice in a made-up currency should render wrong, not crash.
    expect(formatMoney(1000, "ZZZ")).toContain("10.00");
    expect(formatMoney(null)).toBeNull();
  });

  it("parses money the way people type it", () => {
    expect(parseAmount("1,250")).toBe(125000);
    expect(parseAmount("82.50")).toBe(8250);
    expect(parseAmount("-50")).toBe(-5000);
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("about £80")).toBeNull();
    // Three decimal places is a typo, not a third of a penny.
    expect(parseAmount("1.005")).toBeNull();
  });

  it("parses a tax rate and refuses an impossible one", () => {
    expect(parseTaxRate("20")).toBe(2000);
    expect(parseTaxRate("17.5")).toBe(1750);
    expect(parseTaxRate("20%")).toBe(2000);
    expect(parseTaxRate("")).toBe(0);
    // 200% is the shape of a typo for 20, and it is worth refusing.
    expect(parseTaxRate("200")).toBeNull();
    expect(parseTaxRate("lots")).toBeNull();
  });
});
