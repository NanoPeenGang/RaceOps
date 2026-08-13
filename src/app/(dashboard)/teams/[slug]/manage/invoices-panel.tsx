"use client";

import { useState } from "react";
import Link from "next/link";
import { InvoiceStatus } from "@prisma/client";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/trpc/root";
import { api } from "@/lib/trpc/client";
import {
  canRecordPayment,
  canVoid,
  daysOverdue,
  defaultDueDate,
  formatInvoiceNumber,
  formatMoney,
  formatTaxRate,
  isEditable,
  isOverdue,
  parseAmount,
  parseTaxRate,
  settlementLabel,
} from "@/lib/invoices";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Form } from "@/components/ui/form";
import { EmptyState, Section, Stat } from "@/components/ui/page";
import { ListSkeleton } from "@/components/ui/skeleton";

/**
 * Billing outside work.
 *
 * Teams take in third-party jobs — a corner rebuild for the garage next door,
 * fabrication for a customer car, an engineer lent out for a weekend — and
 * then invoice it a week later from notes, in a spreadsheet, because the
 * platform that already holds the service record and the parts used could not
 * produce a document.
 *
 * The boundary is printed on the panel rather than left to be discovered: this
 * writes and prints an invoice and records what came in against it. It does
 * not move money and it is not an accounting system.
 */

type Invoices = inferRouterOutputs<AppRouter>["garage"]["invoices"];
type Invoice = Invoices["invoices"][number];

export function InvoicesPanel({
  teamId,
  teamSlug,
}: {
  teamId: string;
  teamSlug: string;
}) {
  const list = api.garage.invoices.useQuery(
    { teamId },
    { meta: { silenceError: true } },
  );
  const [creating, setCreating] = useState(false);

  if (list.error) {
    // Not an error screen: most of the roster is not a manager, and this
    // panel simply is not theirs.
    return null;
  }
  if (!list.data) return <ListSkeleton rows={2} />;

  const invoices = list.data.invoices;
  const now = new Date();
  const outstanding = new Map<string, number>();
  let overdueCount = 0;
  for (const invoice of invoices) {
    if (invoice.status !== InvoiceStatus.ISSUED) continue;
    outstanding.set(
      invoice.currency,
      (outstanding.get(invoice.currency) ?? 0) +
        invoice.settlement.outstandingMinor,
    );
    if (isOverdue(invoice, invoice.settlement, now)) overdueCount += 1;
  }

  return (
    <Section
      title="Invoices"
      description="For work you did for somebody else. Writes and prints the document and records what came in — it does not move the money, and it is not your accounts package."
      actions={
        <div className="flex flex-wrap gap-2">
          <Link href={`/teams/${teamSlug}/invoices`}>
            <Button size="sm" variant="outline">
              Print run
            </Button>
          </Link>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setCreating((open) => !open)}
          >
            {creating ? "Cancel" : "Raise an invoice"}
          </Button>
        </div>
      }
    >
      {invoices.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-3">
          {[...outstanding.entries()].map(([currency, minor]) => (
            <Stat
              key={currency}
              label={`Outstanding — ${currency}`}
              value={formatMoney(minor, currency) ?? "—"}
            />
          ))}
          <Stat
            label="Overdue"
            value={overdueCount}
            tone={overdueCount > 0 ? "alert" : "default"}
            hint={overdueCount > 0 ? "Past the date and unpaid" : undefined}
          />
        </div>
      )}

      {creating && (
        <NewInvoice teamId={teamId} onCreated={() => setCreating(false)} />
      )}

      {invoices.length === 0 ? (
        <EmptyState
          title="Nothing invoiced yet"
          description="If you service somebody else's car, or hire out a bay or an engineer, raise it here and print the invoice."
        />
      ) : (
        <div className="space-y-3">
          {invoices.map((invoice) => (
            <InvoiceRow
              key={invoice.id}
              invoice={invoice}
              teamSlug={teamSlug}
              teamId={teamId}
            />
          ))}
        </div>
      )}
    </Section>
  );
}

function NewInvoice({
  teamId,
  onCreated,
}: {
  teamId: string;
  onCreated: () => void;
}) {
  const utils = api.useUtils();
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerRef, setCustomerRef] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [taxRate, setTaxRate] = useState("");
  const [taxLabel, setTaxLabel] = useState("");
  const [terms, setTerms] = useState("Net 30");

  const create = api.garage.createInvoice.useMutation({
    meta: { silenceError: true, successMessage: "Draft invoice started." },
    onSuccess: async () => {
      await utils.garage.invoices.invalidate({ teamId });
      onCreated();
    },
  });

  const basisPoints = parseTaxRate(taxRate);

  return (
    <Card>
      <CardContent className="p-5">
        <Form
          busy={create.isPending}
          className="space-y-3"
          onSubmit={() => {
            if (basisPoints === null) return;
            create.mutate({
              teamId,
              customerName: customerName.trim(),
              customerEmail: customerEmail.trim() || null,
              customerRef: customerRef.trim() || null,
              currency,
              taxRateBasisPoints: basisPoints,
              taxLabel: taxLabel.trim() || null,
              terms: terms.trim() || null,
              // A date the customer's accounts department will assume anyway.
              dueOn: defaultDueDate(new Date()),
            });
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm font-medium">
              Who is it for?
              <input
                className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="Northgate Motorsport Ltd"
                required
              />
            </label>
            <label className="text-sm font-medium">
              Their email
              <input
                type="email"
                className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
                value={customerEmail}
                onChange={(e) => setCustomerEmail(e.target.value)}
              />
            </label>
            <label className="text-sm font-medium">
              Their reference
              <input
                className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
                value={customerRef}
                onChange={(e) => setCustomerRef(e.target.value)}
                placeholder="PO number, job number, car number"
              />
            </label>
            <label className="text-sm font-medium">
              Currency
              <input
                className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm uppercase"
                value={currency}
                maxLength={3}
                onChange={(e) => setCurrency(e.target.value.toUpperCase())}
              />
            </label>
            <label className="text-sm font-medium">
              Tax rate
              <input
                className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
                value={taxRate}
                onChange={(e) => setTaxRate(e.target.value)}
                placeholder="20"
                inputMode="decimal"
              />
              <span className="mt-1 block text-xs font-normal text-brand-black/50">
                A percentage. We apply what you type — we do not know what rate
                you owe where you trade.
              </span>
            </label>
            <label className="text-sm font-medium">
              What to call it
              <input
                className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
                value={taxLabel}
                onChange={(e) => setTaxLabel(e.target.value)}
                placeholder="VAT, GST, Sales tax"
              />
            </label>
            <label className="text-sm font-medium sm:col-span-2">
              Payment terms
              <input
                className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
                value={terms}
                onChange={(e) => setTerms(e.target.value)}
              />
            </label>
          </div>

          {taxRate.trim() !== "" && basisPoints === null && (
            <p className="text-sm text-brand-red">
              That is not a percentage between 0 and 100.
            </p>
          )}
          {create.error && (
            <p className="text-sm text-brand-red">{create.error.message}</p>
          )}

          <Button
            type="submit"
            variant="primary"
            disabled={
              create.isPending ||
              customerName.trim().length === 0 ||
              basisPoints === null
            }
          >
            {create.isPending ? "Starting…" : "Start the draft"}
          </Button>
        </Form>
      </CardContent>
    </Card>
  );
}

function InvoiceRow({
  invoice,
  teamSlug,
  teamId,
}: {
  invoice: Invoice;
  teamSlug: string;
  teamId: string;
}) {
  const [open, setOpen] = useState(false);
  const overdue = isOverdue(invoice, invoice.settlement);
  const label = settlementLabel(invoice.status, invoice.settlement);

  return (
    <Card className={overdue ? "border-brand-red/40" : undefined}>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-medium">{invoice.customerName}</p>
              <Badge variant="outline">
                {formatInvoiceNumber(invoice.number)}
              </Badge>
              <Badge
                variant={
                  invoice.settlement.settled || overdue ? "verified" : "default"
                }
              >
                {overdue
                  ? `${daysOverdue(invoice.dueOn!)} days overdue`
                  : label}
              </Badge>
            </div>
            <p className="mt-1 text-xs text-brand-black/60">
              {[
                invoice.customerRef,
                invoice.car?.name,
                invoice.event?.name,
                invoice.issuedOn
                  ? `Issued ${invoice.issuedOn.toLocaleDateString()}`
                  : "Not issued",
                invoice.dueOn
                  ? `Due ${invoice.dueOn.toLocaleDateString()}`
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          <div className="text-right">
            <p className="text-lg font-semibold tabular-nums">
              {formatMoney(invoice.totals.totalMinor, invoice.currency)}
            </p>
            {invoice.settlement.outstandingMinor > 0 &&
              invoice.status === InvoiceStatus.ISSUED && (
                <p className="text-xs text-brand-black/60">
                  {formatMoney(
                    invoice.settlement.outstandingMinor,
                    invoice.currency,
                  )}{" "}
                  outstanding
                </p>
              )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs">
          <button
            type="button"
            className="text-brand-black/60 hover:text-brand-black"
            onClick={() => setOpen((value) => !value)}
          >
            {open ? "Hide" : `${invoice.lines.length} line(s)`}
          </button>
          {invoice.status !== InvoiceStatus.DRAFT && (
            <Link
              href={`/teams/${teamSlug}/invoices/${invoice.id}`}
              className="text-brand-red hover:underline"
            >
              Print / send →
            </Link>
          )}
        </div>

        {open && <InvoiceDetail invoice={invoice} teamId={teamId} />}
      </CardContent>
    </Card>
  );
}

function InvoiceDetail({
  invoice,
  teamId,
}: {
  invoice: Invoice;
  teamId: string;
}) {
  const utils = api.useUtils();
  const refresh = () => utils.garage.invoices.invalidate({ teamId });
  const editable = isEditable(invoice.status);

  return (
    <div className="space-y-4 border-t border-brand-black/10 pt-3">
      <table className="w-full text-sm">
        <tbody>
          {invoice.lines.map((line) => (
            <tr key={line.id} className="border-b border-brand-black/5">
              <td className="py-1.5">
                {line.description}
                {!line.taxable && invoice.taxRateBasisPoints > 0 && (
                  <span className="ml-2 text-xs text-brand-black/50">
                    no {invoice.taxLabel ?? "tax"}
                  </span>
                )}
              </td>
              <td className="py-1.5 text-right tabular-nums text-brand-black/60">
                {line.quantity} {line.unit ?? ""} ×{" "}
                {formatMoney(line.unitMinor, invoice.currency)}
              </td>
              <td className="py-1.5 pl-3 text-right font-medium tabular-nums">
                {formatMoney(line.amountMinor, invoice.currency)}
              </td>
              {editable && (
                <td className="w-8 py-1.5 text-right">
                  <RemoveLine lineId={line.id} onDone={refresh} />
                </td>
              )}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={2} className="pt-2 text-right text-brand-black/60">
              Subtotal
            </td>
            <td
              className="pt-2 text-right tabular-nums"
              colSpan={editable ? 2 : 1}
            >
              {formatMoney(invoice.totals.subtotalMinor, invoice.currency)}
            </td>
          </tr>
          {invoice.taxRateBasisPoints > 0 && (
            <tr>
              <td colSpan={2} className="text-right text-brand-black/60">
                {invoice.taxLabel ?? "Tax"} at{" "}
                {formatTaxRate(invoice.taxRateBasisPoints)}
              </td>
              <td
                className="text-right tabular-nums"
                colSpan={editable ? 2 : 1}
              >
                {formatMoney(invoice.totals.taxMinor, invoice.currency)}
              </td>
            </tr>
          )}
          <tr className="font-semibold">
            <td colSpan={2} className="text-right">
              Total
            </td>
            <td className="text-right tabular-nums" colSpan={editable ? 2 : 1}>
              {formatMoney(invoice.totals.totalMinor, invoice.currency)}
            </td>
          </tr>
        </tfoot>
      </table>

      {editable && <AddLine invoiceId={invoice.id} onDone={refresh} />}
      {editable && <IssueControls invoice={invoice} onDone={refresh} />}

      {invoice.payments.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-black/50">
            Received
          </p>
          {invoice.payments.map((payment) => (
            <div
              key={payment.id}
              className="flex flex-wrap items-baseline gap-2 text-sm"
            >
              <span className="flex-1">
                {formatMoney(payment.amountMinor, invoice.currency)} on{" "}
                {payment.receivedOn.toLocaleDateString()}
                {payment.method ? ` · ${payment.method}` : ""}
                {payment.reference ? ` · ${payment.reference}` : ""}
                {/* Says how it got here. Reconciling a bank statement later
                    means telling a real receipt from a tick-off, and the two
                    rows are otherwise identical. */}
                {payment.note && (
                  <span className="text-brand-black/50"> · {payment.note}</span>
                )}
              </span>
              <RemovePayment paymentId={payment.id} onDone={refresh} />
            </div>
          ))}
        </div>
      )}

      {canRecordPayment(invoice.status) &&
        invoice.settlement.outstandingMinor > 0 && (
          <>
            <MarkPaid invoice={invoice} onDone={refresh} />
            <RecordPayment invoice={invoice} onDone={refresh} />
          </>
        )}

      <div className="flex flex-wrap items-center gap-2">
        {canVoid(invoice.status) && invoice.payments.length === 0 && (
          <VoidInvoice invoiceId={invoice.id} onDone={refresh} />
        )}
        {invoice.status !== InvoiceStatus.DRAFT && (
          <DeleteInvoice invoice={invoice} onDone={refresh} />
        )}
      </div>
    </div>
  );
}

function RemoveLine({
  lineId,
  onDone,
}: {
  lineId: string;
  onDone: () => void;
}) {
  const remove = api.garage.removeInvoiceLine.useMutation({
    onSuccess: onDone,
  });
  return (
    <button
      type="button"
      aria-label="Remove line"
      className="text-brand-black/40 hover:text-brand-red"
      disabled={remove.isPending}
      onClick={() => remove.mutate({ lineId })}
    >
      ✕
    </button>
  );
}

function AddLine({
  invoiceId,
  onDone,
}: {
  invoiceId: string;
  onDone: () => void;
}) {
  const [description, setDescription] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [rate, setRate] = useState("");
  const [unit, setUnit] = useState("");
  const [taxable, setTaxable] = useState(true);

  const add = api.garage.addInvoiceLine.useMutation({
    meta: { silenceError: true },
    onSuccess: () => {
      setDescription("");
      setQuantity("1");
      setRate("");
      setUnit("");
      onDone();
    },
  });

  const unitMinor = parseAmount(rate);
  const parsedQuantity = Number(quantity);
  const valid =
    description.trim().length > 0 &&
    Number.isFinite(parsedQuantity) &&
    parsedQuantity > 0 &&
    unitMinor !== null;

  return (
    <Form
      busy={add.isPending}
      className="space-y-2 rounded-md border border-brand-black/10 p-3"
      onSubmit={() => {
        if (!valid) return;
        add.mutate({
          invoiceId,
          description: description.trim(),
          quantity: parsedQuantity,
          unitMinor: unitMinor!,
          unit: unit.trim() || null,
          taxable,
        });
      }}
    >
      <div className="grid gap-2 sm:grid-cols-[1fr_5rem_6rem_5rem]">
        <input
          className="rounded-md border border-brand-black/20 px-2 py-1.5 text-sm"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Gearbox rebuild, labour"
          aria-label="Description"
        />
        <input
          className="rounded-md border border-brand-black/20 px-2 py-1.5 text-sm"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          inputMode="decimal"
          aria-label="Quantity"
        />
        <input
          className="rounded-md border border-brand-black/20 px-2 py-1.5 text-sm"
          value={rate}
          onChange={(e) => setRate(e.target.value)}
          placeholder="Rate"
          inputMode="decimal"
          aria-label="Unit rate"
        />
        <input
          className="rounded-md border border-brand-black/20 px-2 py-1.5 text-sm"
          value={unit}
          onChange={(e) => setUnit(e.target.value)}
          placeholder="hours"
          aria-label="Unit"
        />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={taxable}
            onChange={(e) => setTaxable(e.target.checked)}
          />
          Tax applies to this line
        </label>
        <Button
          type="submit"
          size="sm"
          variant="outline"
          disabled={!valid || add.isPending}
        >
          Add line
        </Button>
        {add.error && (
          <span className="text-xs text-brand-red">{add.error.message}</span>
        )}
      </div>
    </Form>
  );
}

function IssueControls({
  invoice,
  onDone,
}: {
  invoice: Invoice;
  onDone: () => void;
}) {
  const issue = api.garage.issueInvoice.useMutation({
    meta: {
      silenceError: true,
      successMessage: "Invoice issued and numbered.",
    },
    onSuccess: onDone,
  });
  const remove = api.garage.deleteInvoice.useMutation({ onSuccess: onDone });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="primary"
        size="sm"
        disabled={issue.isPending || invoice.lines.length === 0}
        onClick={() => issue.mutate({ invoiceId: invoice.id })}
      >
        {issue.isPending ? "Issuing…" : "Issue it"}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        disabled={remove.isPending}
        onClick={() => remove.mutate({ invoiceId: invoice.id })}
      >
        Delete draft
      </Button>
      <span className="text-xs text-brand-black/50">
        Issuing gives it its number and freezes the figures.
      </span>
      {remove.error && (
        <span className="text-xs text-brand-red">{remove.error.message}</span>
      )}
      {issue.error && (
        <span className="text-xs text-brand-red">{issue.error.message}</span>
      )}
    </div>
  );
}

function RecordPayment({
  invoice,
  onDone,
}: {
  invoice: Invoice;
  onDone: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [receivedOn, setReceivedOn] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [method, setMethod] = useState("");
  const [reference, setReference] = useState("");

  const record = api.garage.recordInvoicePayment.useMutation({
    meta: { silenceError: true, successMessage: "Payment recorded." },
    onSuccess: () => {
      setAmount("");
      setReference("");
      onDone();
    },
  });

  const minor = parseAmount(amount);

  return (
    <Form
      busy={record.isPending}
      className="space-y-2 rounded-md border border-brand-black/10 p-3"
      onSubmit={() => {
        if (minor === null || minor <= 0) return;
        record.mutate({
          invoiceId: invoice.id,
          amountMinor: minor,
          receivedOn: new Date(`${receivedOn}T00:00:00`),
          method: method.trim() || null,
          reference: reference.trim() || null,
        });
      }}
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-brand-black/50">
        Record what came in
      </p>
      <div className="grid gap-2 sm:grid-cols-4">
        <input
          className="rounded-md border border-brand-black/20 px-2 py-1.5 text-sm"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder={`Amount (${invoice.currency})`}
          inputMode="decimal"
          aria-label="Amount received"
        />
        <input
          type="date"
          className="rounded-md border border-brand-black/20 px-2 py-1.5 text-sm"
          value={receivedOn}
          onChange={(e) => setReceivedOn(e.target.value)}
          aria-label="Date received"
        />
        <input
          className="rounded-md border border-brand-black/20 px-2 py-1.5 text-sm"
          value={method}
          onChange={(e) => setMethod(e.target.value)}
          placeholder="Bank transfer"
          aria-label="Method"
        />
        <input
          className="rounded-md border border-brand-black/20 px-2 py-1.5 text-sm"
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          placeholder="Reference"
          aria-label="Reference"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="submit"
          size="sm"
          variant="outline"
          disabled={record.isPending || minor === null || minor <= 0}
        >
          Record
        </Button>
        <span className="text-xs text-brand-black/50">
          {formatMoney(invoice.settlement.outstandingMinor, invoice.currency)}{" "}
          outstanding. We do not take the payment — this is your note of it.
        </span>
        {record.error && (
          <span className="text-xs text-brand-red">{record.error.message}</span>
        )}
      </div>
    </Form>
  );
}

function VoidInvoice({
  invoiceId,
  onDone,
}: {
  invoiceId: string;
  onDone: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const voidIt = api.garage.voidInvoice.useMutation({
    meta: { silenceError: true, successMessage: "Invoice voided." },
    onSuccess: onDone,
  });

  if (!confirming) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>
        Void this invoice
      </Button>
    );
  }

  return (
    <Form
      busy={voidIt.isPending}
      className="flex flex-wrap gap-2"
      onSubmit={() => {
        if (!reason.trim()) return;
        voidIt.mutate({ invoiceId, reason: reason.trim() });
      }}
    >
      <input
        className="min-w-48 flex-1 rounded-md border border-brand-black/20 px-2 py-1.5 text-sm"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Why — it stays on the record"
        aria-label="Reason for voiding"
      />
      <Button
        type="submit"
        size="sm"
        variant="outline"
        disabled={!reason.trim()}
      >
        Void it
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
        Keep it
      </Button>
      {voidIt.error && (
        <span className="text-xs text-brand-red">{voidIt.error.message}</span>
      )}
    </Form>
  );
}

/**
 * Deleting an invoice that has been issued.
 *
 * Kept separate from the draft delete and from voiding, because it is a
 * different act with a different consequence. Voiding keeps the number and
 * leaves the run gapless; deleting takes the number out of the sequence for
 * good and takes any recorded payments with it.
 *
 * Both are offered rather than one being hidden. There is a real case for each
 * — an invoice for work that was genuinely done but will not be collected is a
 * void; one raised against the wrong customer entirely is better erased than
 * left on file. What matters is that the difference is on screen at the moment
 * of choosing, not in a help page.
 */
function DeleteInvoice({
  invoice,
  onDone,
}: {
  invoice: Invoice;
  onDone: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const remove = api.garage.deleteInvoice.useMutation({
    meta: { silenceError: true, successMessage: "Invoice deleted." },
    onSuccess: onDone,
  });

  if (!confirming) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>
        Delete it
      </Button>
    );
  }

  return (
    <div className="w-full space-y-2 rounded-md border border-brand-red/40 p-3">
      <p className="text-sm">
        Delete {formatInvoiceNumber(invoice.number)} for good?
      </p>
      <ul className="list-disc space-y-0.5 pl-5 text-xs text-brand-black/70">
        <li>
          {invoice.lines.length} line
          {invoice.lines.length === 1 ? "" : "s"} go with it.
        </li>
        {invoice.payments.length > 0 && (
          <li>
            {formatMoney(invoice.settlement.paidMinor, invoice.currency)}{" "}
            recorded as received will no longer be on the books.
          </li>
        )}
        <li>
          {formatInvoiceNumber(invoice.number)} is never issued again — the next
          invoice carries on past it, so your run will have a gap where this one
          was.
        </li>
      </ul>
      <p className="text-xs text-brand-black/60">
        If the work was real and you simply are not collecting it, void it
        instead — that keeps the number and the record.
      </p>
      {remove.error && (
        <p className="text-xs text-brand-red">{remove.error.message}</p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="primary"
          disabled={remove.isPending}
          onClick={() =>
            remove.mutate({ invoiceId: invoice.id, deleteIssued: true })
          }
        >
          {remove.isPending ? "Deleting…" : "Delete it"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
          Keep it
        </Button>
      </div>
    </div>
  );
}

/**
 * Settling an invoice in one tap.
 *
 * Most invoices are paid once, in full, and typing the amount back in when the
 * platform already knows it is four fields of ceremony. This writes a payment
 * for exactly what is outstanding, dated today.
 *
 * It is a payment rather than a paid flag on purpose. Settlement is derived
 * from the money recorded against an invoice, so a flag could disagree with it
 * — a "paid" invoice with nothing against it is the discrepancy nobody finds
 * until year end. This is the same fact entered faster, not a second source of
 * truth.
 */
function MarkPaid({
  invoice,
  onDone,
}: {
  invoice: Invoice;
  onDone: () => void;
}) {
  const mark = api.garage.markInvoicePaid.useMutation({
    meta: { silenceError: true, successMessage: "Marked paid." },
    onSuccess: onDone,
  });

  const outstanding = formatMoney(
    invoice.settlement.outstandingMinor,
    invoice.currency,
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="primary"
        size="sm"
        disabled={mark.isPending}
        onClick={() => mark.mutate({ invoiceId: invoice.id })}
      >
        {mark.isPending
          ? "Marking…"
          : invoice.settlement.partial
            ? `Mark the remaining ${outstanding} paid`
            : `Mark ${outstanding} paid`}
      </Button>
      <span className="text-xs text-brand-black/50">
        Records it as received today. Use the fields below for a deposit, a
        different date, or a reference.
      </span>
      {mark.error && (
        <span className="text-xs text-brand-red">{mark.error.message}</span>
      )}
    </div>
  );
}

/**
 * Taking a payment back off.
 *
 * The other half of marking one paid: a tick-off in the wrong row has to be
 * correctable, and without this the only way back would be deleting the
 * invoice — which takes its number with it.
 */
function RemovePayment({
  paymentId,
  onDone,
}: {
  paymentId: string;
  onDone: () => void;
}) {
  const remove = api.garage.removeInvoicePayment.useMutation({
    meta: { successMessage: "Payment removed." },
    onSuccess: onDone,
  });
  return (
    <button
      type="button"
      className="text-xs text-brand-black/50 hover:text-brand-red"
      disabled={remove.isPending}
      onClick={() => remove.mutate({ paymentId })}
    >
      Remove
    </button>
  );
}
