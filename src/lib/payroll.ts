import { PayBasis, PayRunStatus } from "@prisma/client";
import { PAY_BASIS_LABELS, PAY_BASIS_UNITS } from "@/lib/offers";

/**
 * Team payroll.
 *
 * **This is not a payroll processor and must never be described as one.** It
 * does not withhold tax, file returns, or move money. It works out what is
 * owed, records what was paid, and exports the figures for whoever actually
 * runs the payroll — an accountant, a bureau, or a bank transfer. A team that
 * believed otherwise would be making a genuinely costly mistake, which is why
 * the limit is stated here, on the page, and in the README rather than buried
 * in a settings screen.
 *
 * Everything is integer minor units. Money as a float is a rounding bug that
 * pays somebody £0.01 less every month and is found in an audit two years
 * later, and there is no reason to accept that risk for arithmetic this
 * simple.
 */

export const PAY_RUN_STATUS_LABELS: Record<PayRunStatus, string> = {
  DRAFT: "Draft",
  APPROVED: "Approved",
  PAID: "Paid",
  CANCELED: "Canceled",
};

/** A run whose figures can still change. */
export function isEditable(status: PayRunStatus): boolean {
  return status === PayRunStatus.DRAFT;
}

/**
 * A run whose lines can be marked paid.
 *
 * Approved, not draft. Marking a draft line paid would let money go out
 * against a figure nobody signed off, which is the one thing an approval step
 * exists to prevent.
 */
export function canRecordPayment(status: PayRunStatus): boolean {
  return status === PayRunStatus.APPROVED || status === PayRunStatus.PAID;
}

export interface LineInput {
  basis: PayBasis;
  quantity: number;
  rateMinor: number;
  adjustmentMinor?: number;
}

/**
 * What a line comes to.
 *
 * Rounded once, at the end, with `Math.round` on the product before the
 * adjustment is added — so 7.5 hours at £12.33 is one rounding, not two. An
 * unpaid line is zero regardless of what is in the boxes: the basis is the
 * statement of fact and the numbers behind it are leftovers from before
 * somebody changed it.
 */
export function lineAmountMinor(line: LineInput): number {
  if (line.basis === PayBasis.UNPAID) return 0;
  const base = Math.round(line.quantity * line.rateMinor);
  return base + (line.adjustmentMinor ?? 0);
}

export type LineProblem =
  | { reason: "negative-total"; message: string }
  | { reason: "quantity"; message: string }
  | { reason: "rate"; message: string };

/**
 * Whether a line is payable as written.
 *
 * A deduction bigger than the pay is the case worth catching: it means the
 * team owes nothing and the person owes *them*, which this model does not
 * represent and should not silently turn into a negative payment.
 */
export function checkLine(line: LineInput): LineProblem | null {
  if (!Number.isFinite(line.quantity) || line.quantity < 0) {
    return { reason: "quantity", message: "Quantity cannot be negative." };
  }
  if (!Number.isFinite(line.rateMinor) || line.rateMinor < 0) {
    return { reason: "rate", message: "The rate cannot be negative." };
  }
  if (lineAmountMinor(line) < 0) {
    return {
      reason: "negative-total",
      message:
        "That deduction is larger than the pay. Record it as a separate arrangement rather than a negative line.",
    };
  }
  return null;
}

export interface PayrollLineLike {
  currency: string;
  amountMinor: number;
  paidAt?: Date | string | null;
  userId?: string | null;
  payeeName?: string | null;
}

export interface CurrencyTotal {
  currency: string;
  grossMinor: number;
  paidMinor: number;
  outstandingMinor: number;
}

/**
 * Run totals, per currency.
 *
 * Split by currency and never summed across them. A team paying a driver in
 * euros and a mechanic in dollars has two numbers, and one combined figure
 * would be a made-up amount in a made-up currency — worse than useless on a
 * document somebody pays people from.
 */
export function runTotals(
  lines: readonly PayrollLineLike[],
): CurrencyTotal[] {
  const totals = new Map<string, CurrencyTotal>();
  for (const line of lines) {
    const current = totals.get(line.currency) ?? {
      currency: line.currency,
      grossMinor: 0,
      paidMinor: 0,
      outstandingMinor: 0,
    };
    current.grossMinor += line.amountMinor;
    if (line.paidAt) current.paidMinor += line.amountMinor;
    else current.outstandingMinor += line.amountMinor;
    totals.set(line.currency, current);
  }
  return [...totals.values()].sort((a, b) => b.grossMinor - a.grossMinor);
}

export interface PayeeTotal {
  key: string;
  userId: string | null;
  payeeName: string | null;
  currency: string;
  grossMinor: number;
  outstandingMinor: number;
  lineCount: number;
}

/**
 * What each person is owed, per currency.
 *
 * Keyed on payee *and* currency, because somebody paid a retainer in dollars
 * and a per-event fee in euros is two payments, not one row that has to pick a
 * currency to display.
 */
export function payeeTotals(
  lines: readonly PayrollLineLike[],
): PayeeTotal[] {
  const totals = new Map<string, PayeeTotal>();
  for (const line of lines) {
    const identity = line.userId ?? `name:${line.payeeName ?? ""}`;
    const key = `${identity}|${line.currency}`;
    const current = totals.get(key) ?? {
      key,
      userId: line.userId ?? null,
      payeeName: line.payeeName ?? null,
      currency: line.currency,
      grossMinor: 0,
      outstandingMinor: 0,
      lineCount: 0,
    };
    current.grossMinor += line.amountMinor;
    if (!line.paidAt) current.outstandingMinor += line.amountMinor;
    current.lineCount += 1;
    totals.set(key, current);
  }
  return [...totals.values()].sort((a, b) => b.grossMinor - a.grossMinor);
}

/** Whether every line on a run has been paid. Vacuously false for none. */
export function isFullyPaid(lines: readonly PayrollLineLike[]): boolean {
  return lines.length > 0 && lines.every((line) => Boolean(line.paidAt));
}

export interface RateLike {
  basis: PayBasis;
  amountMinor?: number | null;
  currency: string;
  effectiveFrom: Date | string;
  effectiveTo?: Date | string | null;
}

/**
 * The rate in force on a date.
 *
 * A pay run for March must use March's rate even if it is built in December,
 * which is why superseded rates are kept rather than overwritten. Ties go to
 * the one that started most recently.
 */
export function rateOn<T extends RateLike>(
  rates: readonly T[],
  when: Date,
): T | null {
  const at = when.getTime();
  const inForce = rates.filter((rate) => {
    const from = new Date(rate.effectiveFrom).getTime();
    if (from > at) return false;
    if (!rate.effectiveTo) return true;
    return new Date(rate.effectiveTo).getTime() >= at;
  });
  if (inForce.length === 0) return null;
  return inForce.sort(
    (a, b) =>
      new Date(b.effectiveFrom).getTime() - new Date(a.effectiveFrom).getTime(),
  )[0]!;
}

/** Money for display. Minor units in, never a float. */
export function formatMinor(minor: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(minor / 100);
}

/** "12 hours at $18.00" — how a line was arrived at. */
export function describeLine(line: {
  basis: PayBasis;
  quantity: number;
  rateMinor: number;
  currency: string;
}): string {
  if (line.basis === PayBasis.UNPAID) return "Unpaid";
  const unit = PAY_BASIS_UNITS[line.basis];
  const quantity = Number.isInteger(line.quantity)
    ? String(line.quantity)
    : line.quantity.toFixed(2);
  return `${quantity} ${unit} at ${formatMinor(line.rateMinor, line.currency)}`;
}

export interface ExportLine {
  payeeName: string;
  description: string;
  basis: PayBasis;
  quantity: number;
  rateMinor: number;
  adjustmentMinor: number;
  amountMinor: number;
  currency: string;
  paidAt?: Date | string | null;
  paymentReference?: string | null;
}

/**
 * The run as CSV, for whoever actually pays people.
 *
 * Amounts are written in major units with two decimals, because that is what a
 * bank file and an accountant expect — this is the one place the integer
 * discipline is deliberately traded for the format the receiving system reads.
 * The conversion happens once, here, on the way out.
 */
export function toCsv(lines: readonly ExportLine[]): string {
  const header = [
    "Payee",
    "Description",
    "Basis",
    "Quantity",
    "Rate",
    "Adjustment",
    "Amount",
    "Currency",
    "Paid on",
    "Reference",
  ];

  const rows = lines.map((line) => [
    line.payeeName,
    line.description,
    PAY_BASIS_LABELS[line.basis],
    String(line.quantity),
    (line.rateMinor / 100).toFixed(2),
    (line.adjustmentMinor / 100).toFixed(2),
    (line.amountMinor / 100).toFixed(2),
    line.currency,
    line.paidAt ? new Date(line.paidAt).toISOString().slice(0, 10) : "",
    line.paymentReference ?? "",
  ]);

  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
}

/**
 * One CSV cell.
 *
 * Quotes anything containing a comma, quote or newline — a payee called
 * "Smith, John" would otherwise shift every column after it by one, and the
 * amount would land in the currency column of somebody's bank import.
 *
 * The leading apostrophe guards against spreadsheet formula injection: a cell
 * starting `=`, `+`, `-` or `@` is executed by Excel and Sheets on open, and
 * a payee name is attacker-controlled text on a file an accountant opens.
 */
function csvCell(value: string): string {
  const risky = /^[=+\-@\t\r]/.test(value);
  const text = risky ? `'${value}` : value;
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}
