import { InvoiceStatus } from "@prisma/client";

/**
 * Billing third parties for work the team did.
 *
 * The job this exists for: a team takes in outside work — a corner rebuild for
 * the garage next door, fabrication for a customer car, an engineer lent out
 * for a weekend — and then invoices it a week later, on a laptop, from notes.
 * Everything needed is already recorded here, so the invoice should not have
 * to be retyped into a spreadsheet.
 *
 * **What this is not.** It is not an accounting system and it does not move
 * money. There is no ledger, no tax return, no card processing, and no opinion
 * on whether the rate somebody typed is the right one for where they trade.
 * The platform does the arithmetic it is given, prints a document, and records
 * what came in against it. That boundary is stated on the panel itself rather
 * than buried in a tooltip, because a team that believes otherwise will find
 * out at the wrong moment.
 *
 * Everything is integer minor units. Money as a float is a rounding bug with a
 * delay on it.
 */

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  DRAFT: "Draft",
  ISSUED: "Issued",
  VOID: "Void",
};

/** A draft is the only thing still open to editing. */
export function isEditable(status: InvoiceStatus): boolean {
  return status === InvoiceStatus.DRAFT;
}

/** Money can only be recorded against something that was actually sent. */
export function canRecordPayment(status: InvoiceStatus): boolean {
  return status === InvoiceStatus.ISSUED;
}

/**
 * Whether an invoice can still be voided.
 *
 * Only an issued one, and it keeps its number for ever. Deleting it instead
 * would leave a hole in the sequence, and a gap in an invoice run is the first
 * thing an auditor asks about — a void that is visibly a void answers the
 * question before it is asked.
 */
export function canVoid(status: InvoiceStatus): boolean {
  return status === InvoiceStatus.ISSUED;
}

// -- Arithmetic --------------------------------------------------------------

export interface LineInput {
  quantity: number;
  unitMinor: number;
}

/**
 * What a line comes to.
 *
 * Rounded once, on the product. 7.5 hours at £82.50 is one rounding, not a
 * rounding of the rate followed by a rounding of the total — which is how an
 * invoice ends up a penny away from the quote somebody was given.
 */
export function lineAmountMinor(line: LineInput): number {
  if (!Number.isFinite(line.quantity) || !Number.isFinite(line.unitMinor)) {
    return 0;
  }
  return Math.round(line.quantity * line.unitMinor);
}

export type LineProblem =
  | { field: "description"; message: string }
  | { field: "quantity"; message: string }
  | { field: "unitMinor"; message: string };

export function checkLine(line: {
  description: string;
  quantity: number;
  unitMinor: number;
}): LineProblem | null {
  if (!line.description.trim()) {
    return {
      field: "description",
      message: "Say what the line is for — it is what the customer reads.",
    };
  }
  if (!Number.isFinite(line.quantity) || line.quantity <= 0) {
    return {
      field: "quantity",
      message: "A line has to count something. Use a negative rate to discount.",
    };
  }
  if (!Number.isFinite(line.unitMinor)) {
    return { field: "unitMinor", message: "That rate is not a number." };
  }
  return null;
}

export interface TotalledLine {
  amountMinor: number;
  taxable: boolean;
}

export interface InvoiceTotals {
  /** Everything before tax, taxable or not. */
  subtotalMinor: number;
  /** The part of the subtotal the rate applies to. */
  taxableMinor: number;
  taxMinor: number;
  totalMinor: number;
}

/**
 * The foot of the invoice.
 *
 * Tax is worked out on the taxable subtotal in one go rather than per line and
 * summed. Per-line tax rounds once per line, and on a twenty-line job that
 * drifts from the figure a customer gets by applying the rate to the total
 * themselves — which is the first thing they do, and the first thing they
 * query.
 */
export function invoiceTotals(
  lines: readonly TotalledLine[],
  taxRateBasisPoints: number,
): InvoiceTotals {
  let subtotalMinor = 0;
  let taxableMinor = 0;
  for (const line of lines) {
    subtotalMinor += line.amountMinor;
    if (line.taxable) taxableMinor += line.amountMinor;
  }
  const rate = Number.isFinite(taxRateBasisPoints) ? taxRateBasisPoints : 0;
  const taxMinor = Math.round((taxableMinor * rate) / 10_000);
  return {
    subtotalMinor,
    taxableMinor,
    taxMinor,
    totalMinor: subtotalMinor + taxMinor,
  };
}

// -- Settlement --------------------------------------------------------------

export interface PaymentRecord {
  amountMinor: number;
}

export interface Settlement {
  paidMinor: number;
  outstandingMinor: number;
  settled: boolean;
  /** Paid something, but not all of it — a deposit against a big job. */
  partial: boolean;
  /** They sent more than was asked. Worth surfacing, never hidden. */
  overpaidMinor: number;
}

/**
 * How much is still owed.
 *
 * Derived from the payments rather than stored as a flag, so the status and
 * the money can never disagree — a "paid" invoice with nothing recorded
 * against it is the discrepancy nobody finds until year end.
 *
 * A deposit-and-balance split is the normal shape of a large fabrication job,
 * which is why partial is a first-class state and not a rounding of "unpaid".
 */
export function settlementOf(
  totalMinor: number,
  payments: readonly PaymentRecord[],
): Settlement {
  const paidMinor = payments.reduce((sum, one) => sum + one.amountMinor, 0);
  const outstandingMinor = Math.max(totalMinor - paidMinor, 0);
  return {
    paidMinor,
    outstandingMinor,
    settled: paidMinor >= totalMinor && totalMinor > 0,
    partial: paidMinor > 0 && paidMinor < totalMinor,
    overpaidMinor: Math.max(paidMinor - totalMinor, 0),
  };
}

/**
 * What to call the state on screen.
 *
 * Settlement is folded into the status here rather than shown beside it,
 * because "Issued · Paid" reads as two facts somebody has to combine, and the
 * one they want is whether the money arrived.
 */
export function settlementLabel(
  status: InvoiceStatus,
  settlement: Settlement,
): string {
  if (status !== InvoiceStatus.ISSUED) return INVOICE_STATUS_LABELS[status];
  if (settlement.settled) return "Paid";
  if (settlement.partial) return "Part paid";
  return "Awaiting payment";
}

// -- Chasing -----------------------------------------------------------------

/**
 * An invoice past its date with money still on it.
 *
 * Only issued ones, and only where something is actually outstanding. An
 * invoice paid late is not overdue, it is finished, and listing it would make
 * the chase list something people stop reading.
 */
export function isOverdue(
  invoice: { status: InvoiceStatus; dueOn: Date | null },
  settlement: Settlement,
  now: Date = new Date(),
): boolean {
  if (invoice.status !== InvoiceStatus.ISSUED) return false;
  if (!invoice.dueOn) return false;
  if (settlement.outstandingMinor <= 0) return false;
  return invoice.dueOn.getTime() < now.getTime();
}

export function daysOverdue(dueOn: Date, now: Date = new Date()): number {
  return Math.max(
    0,
    Math.floor((now.getTime() - dueOn.getTime()) / 86_400_000),
  );
}

/**
 * The default payment window, in days.
 *
 * Thirty, because it is what most of the trade quotes and what a customer's
 * accounts department will assume whatever the invoice says. A team wanting
 * something else types it; a team wanting to not think about it gets the
 * answer everybody else uses.
 */
export const DEFAULT_TERMS_DAYS = 30;

export function defaultDueDate(
  issuedOn: Date,
  days = DEFAULT_TERMS_DAYS,
): Date {
  const due = new Date(issuedOn);
  due.setDate(due.getDate() + days);
  return due;
}

// -- Presentation ------------------------------------------------------------

/**
 * The number as it is printed and quoted down a phone.
 *
 * Zero-padded so a run sorts as text the way it sorts as numbers, and prefixed
 * so it is recognisable as an invoice number when a customer's accounts
 * department pastes it into a reference field with nothing else around it.
 */
export function formatInvoiceNumber(number: number | null): string {
  if (number === null) return "Draft";
  return `INV-${String(number).padStart(4, "0")}`;
}

/** Minor units to a readable figure. Null stays null, not "$0.00". */
export function formatMoney(
  minor: number | null | undefined,
  currency = "USD",
): string | null {
  if (minor === null || minor === undefined) return null;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(minor / 100);
  } catch {
    // An unrecognised code must not take the invoice down with it.
    return `${(minor / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

/** "20%" from 2000 basis points, without a float in sight on the way. */
export function formatTaxRate(basisPoints: number): string {
  const whole = Math.floor(basisPoints / 100);
  const fraction = basisPoints % 100;
  if (fraction === 0) return `${whole}%`;
  return `${whole}.${String(fraction).padStart(2, "0").replace(/0$/, "")}%`;
}

/** Parses a typed amount ("1,250" or "1250.50") into minor units. */
export function parseAmount(input: string): number | null {
  const cleaned = input.replace(/[,\s]/g, "");
  if (!cleaned) return null;
  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}

/** Parses a typed percentage ("20", "17.5") into basis points. */
export function parseTaxRate(input: string): number | null {
  const cleaned = input.trim().replace(/%$/, "");
  if (!cleaned) return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const basisPoints = Math.round(Number(cleaned) * 100);
  return basisPoints > 10_000 ? null : basisPoints;
}
