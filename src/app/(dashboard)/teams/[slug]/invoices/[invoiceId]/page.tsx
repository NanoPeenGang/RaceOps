import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { TRPCError } from "@trpc/server";
import { InvoiceStatus } from "@prisma/client";
import { serverApi } from "@/server/trpc/server-caller";
import {
  daysOverdue,
  formatInvoiceNumber,
  formatMoney,
  formatTaxRate,
  isOverdue,
  settlementLabel,
} from "@/lib/invoices";
import { PrintButton } from "@/components/print-button";

/**
 * The document that actually goes to the customer.
 *
 * Server-rendered and plain: this is printed or saved to PDF from the browser
 * and emailed, so it carries no interactive chrome beyond a print button the
 * print stylesheet then hides.
 *
 * Nothing here is stored as a file. An invoice generated from the record
 * cannot drift from it the way an uploaded PDF does the moment a payment is
 * recorded — the figures themselves are frozen at issue, which is the part
 * that must not move.
 */

export const metadata: Metadata = {
  title: "Invoice · RaceOps",
  robots: { index: false, follow: false },
};

export default async function InvoicePage({
  params,
}: {
  params: Promise<{ slug: string; invoiceId: string }>;
}) {
  const { slug, invoiceId } = await params;
  const api = await serverApi();

  let invoice;
  try {
    invoice = await api.garage.invoice({ invoiceId });
  } catch (error) {
    if (error instanceof TRPCError) {
      if (error.code === "NOT_FOUND") notFound();
      if (error.code === "FORBIDDEN" || error.code === "UNAUTHORIZED") {
        return (
          <div className="mx-auto max-w-md space-y-3 py-10 text-center">
            <h1 className="text-xl font-semibold">Not your invoice</h1>
            <p className="text-sm text-brand-black/60">
              Invoices are a team&rsquo;s commercial record — owners and
              managers only.
            </p>
            <Link
              href={`/teams/${slug}`}
              className="inline-block text-sm text-brand-red hover:underline"
            >
              ← Back to the team
            </Link>
          </div>
        );
      }
    }
    throw error;
  }

  // The issuer travels with the invoice rather than being fetched alongside
  // it, so the masthead cannot render half-populated because a second call was
  // slower or failed.
  const { issuer } = invoice;
  const overdue = isOverdue(invoice, invoice.settlement);
  const currency = invoice.currency;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link
          href={`/teams/${slug}/manage?tab=garage`}
          className="text-sm text-brand-red hover:underline"
        >
          ← {issuer.name} garage
        </Link>
        <PrintButton />
      </div>

      {invoice.status === InvoiceStatus.VOID && (
        <p className="rounded-md border border-brand-red/40 p-3 text-sm font-semibold">
          This invoice has been voided. It keeps its number so the run has no
          gap in it, but nothing is owed against it.
        </p>
      )}

      <article className="space-y-6 rounded-lg border border-brand-black/15 p-6 print:border-0 print:p-0">
        {/*
          Who it is from, first and largest. An invoice arriving from a name
          the customer does not recognise is an invoice that gets queried
          rather than paid, so the issuer is the document's own masthead — not
          a line of small print under the total.
        */}
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-brand-black/15 pb-4">
          <div className="flex items-start gap-4">
            <IssuerLogo url={issuer.logoUrl} name={issuer.name} />
            <div className="min-w-0">
              <p className="text-2xl font-bold leading-tight">{issuer.name}</p>
              {issuer.tagline && (
                <p className="text-sm text-brand-black/70">{issuer.tagline}</p>
              )}
              {issuer.homeBase && (
                <p className="text-sm text-brand-black/60">{issuer.homeBase}</p>
              )}
              {issuer.websiteUrl && (
                <p className="text-xs text-brand-black/60">
                  {issuer.websiteUrl.replace(/^https?:\/\//, "")}
                </p>
              )}
              {invoice.taxRegistration && (
                <p className="text-xs text-brand-black/60">
                  {invoice.taxLabel ?? "Tax"} reg. {invoice.taxRegistration}
                </p>
              )}
            </div>
          </div>
          <div className="text-right">
            <p className="text-sm font-semibold uppercase tracking-wide text-brand-black/50">
              Invoice
            </p>
            <p className="text-2xl font-bold tabular-nums">
              {formatInvoiceNumber(invoice.number)}
            </p>
            <p className="text-sm text-brand-black/60">
              {settlementLabel(invoice.status, invoice.settlement)}
              {overdue ? ` · ${daysOverdue(invoice.dueOn!)} days overdue` : ""}
            </p>
          </div>
        </header>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-brand-black/50">
              Billed to
            </p>
            <p className="font-medium">{invoice.customerName}</p>
            {invoice.customerContact && <p>{invoice.customerContact}</p>}
            {invoice.customerAddress && (
              <p className="whitespace-pre-wrap text-sm text-brand-black/70">
                {invoice.customerAddress}
              </p>
            )}
            {invoice.customerEmail && (
              <p className="text-sm text-brand-black/70">
                {invoice.customerEmail}
              </p>
            )}
          </div>
          <dl className="space-y-1 text-sm sm:text-right">
            {invoice.issuedOn && (
              <Field
                label="Issued"
                value={invoice.issuedOn.toLocaleDateString()}
              />
            )}
            {invoice.dueOn && (
              <Field label="Due" value={invoice.dueOn.toLocaleDateString()} />
            )}
            {invoice.customerRef && (
              <Field label="Your reference" value={invoice.customerRef} />
            )}
            {invoice.car?.name && (
              <Field label="Car" value={invoice.car.name} />
            )}
            {invoice.event?.name && (
              <Field label="Event" value={invoice.event.name} />
            )}
          </dl>
        </div>

        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-brand-black/20 text-left">
              <th className="py-2 font-semibold">Description</th>
              <th className="py-2 text-right font-semibold">Qty</th>
              <th className="py-2 text-right font-semibold">Rate</th>
              <th className="py-2 text-right font-semibold">Amount</th>
            </tr>
          </thead>
          <tbody>
            {invoice.lines.map((line) => (
              <tr key={line.id} className="border-b border-brand-black/10">
                <td className="py-2">
                  {line.description}
                  {!line.taxable && invoice.taxRateBasisPoints > 0 && (
                    <span className="ml-2 text-xs text-brand-black/50">
                      no {invoice.taxLabel ?? "tax"}
                    </span>
                  )}
                </td>
                <td className="py-2 text-right tabular-nums">
                  {line.quantity}
                  {line.unit ? ` ${line.unit}` : ""}
                </td>
                <td className="py-2 text-right tabular-nums">
                  {formatMoney(line.unitMinor, currency)}
                </td>
                <td className="py-2 text-right tabular-nums">
                  {formatMoney(line.amountMinor, currency)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <Total
              label="Subtotal"
              value={invoice.totals.subtotalMinor}
              currency={currency}
            />
            {invoice.taxRateBasisPoints > 0 && (
              <Total
                label={`${invoice.taxLabel ?? "Tax"} at ${formatTaxRate(invoice.taxRateBasisPoints)}`}
                value={invoice.totals.taxMinor}
                currency={currency}
              />
            )}
            <Total
              label="Total"
              value={invoice.totals.totalMinor}
              currency={currency}
              strong
            />
            {invoice.settlement.paidMinor > 0 && (
              <>
                <Total
                  label="Received"
                  value={invoice.settlement.paidMinor}
                  currency={currency}
                />
                <Total
                  label="Outstanding"
                  value={invoice.settlement.outstandingMinor}
                  currency={currency}
                  strong
                />
              </>
            )}
          </tfoot>
        </table>

        {invoice.terms && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-brand-black/50">
              Terms
            </p>
            <p className="text-sm">{invoice.terms}</p>
          </div>
        )}
        {invoice.notes && (
          <p className="whitespace-pre-wrap text-sm text-brand-black/70">
            {invoice.notes}
          </p>
        )}
      </article>
    </div>
  );
}

/**
 * The team's mark at the top of the document.
 *
 * A plain `img` rather than `next/image`, on purpose. This page is printed and
 * saved to PDF, and an optimised, lazily-loaded element is a blank square on
 * the sheet the customer actually receives — the one place an image absolutely
 * has to be there when the page is painted.
 *
 * Fixed box with `object-contain` so a wide wordmark and a square badge both
 * sit on the same baseline as the name beside them.
 */
function IssuerLogo({ url, name }: { url: string | null; name: string }) {
  if (!url) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={`${name} logo`}
      className="h-16 w-16 shrink-0 object-contain print:h-14 print:w-14"
    />
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 sm:justify-end">
      <dt className="text-brand-black/50">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

function Total({
  label,
  value,
  currency,
  strong,
}: {
  label: string;
  value: number;
  currency: string;
  strong?: boolean;
}) {
  return (
    <tr className={strong ? "font-semibold" : undefined}>
      <td colSpan={3} className="py-1 text-right">
        {label}
      </td>
      <td className="py-1 text-right tabular-nums">
        {formatMoney(value, currency)}
      </td>
    </tr>
  );
}
