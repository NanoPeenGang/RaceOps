import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { TRPCError } from "@trpc/server";
import { serverApi } from "@/server/trpc/server-caller";
import { partLabelUrl, qrSvg } from "@/server/services/qr";
import { PART_CATEGORY_LABELS } from "@/lib/inventory";
import {
  intoSheets,
  labelCaption,
  LABELS_PER_ROW,
  MIN_LABEL_QR_PX,
} from "@/lib/part-labels";
import { PrintButton } from "@/components/print-button";

/**
 * Peel-off labels for the trailer.
 *
 * Server-rendered inline SVG rather than images: these get printed, and vector
 * stays sharp at whatever a laser printer and a roll of label stock conspire
 * to produce. Inline also means no second request per label, which matters on
 * a sheet with a hundred and fifty of them.
 *
 * The code is never drawn smaller than the size the credential work proved by
 * rasterising and decoding at print size. Shrinking it to fit more on a page
 * is the one change here that would look like an improvement and quietly stop
 * the labels scanning in a dim trailer.
 */

export const metadata: Metadata = {
  title: "Part labels · RaceOps",
  robots: { index: false, follow: false },
};

interface PrintedLabel {
  key: string;
  title: string;
  caption: string | null;
  meta: string | null;
  qr: string;
}

export default async function LabelsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ items?: string }>;
}) {
  const { slug } = await params;
  const { items: requested } = await searchParams;
  const api = await serverApi();

  let team;
  try {
    team = await api.team.bySlug({ slug });
  } catch (error) {
    if (error instanceof TRPCError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  if (!team) notFound();

  let sheet;
  try {
    sheet = await api.garage.labelSheet({
      teamId: team.id,
      itemIds: requested ? requested.split(",").filter(Boolean) : undefined,
    });
  } catch (error) {
    if (
      error instanceof TRPCError &&
      (error.code === "FORBIDDEN" || error.code === "UNAUTHORIZED")
    ) {
      return (
        <div className="mx-auto max-w-md space-y-3 p-4 text-center">
          <h1 className="text-xl font-semibold">Part labels</h1>
          <p className="text-sm text-brand-black/60">
            Managers, engineers and crew print labels. Ask one of them, or open
            the garage to see what is on the shelf.
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
    throw error;
  }

  const labels: PrintedLabel[] = [];
  for (const item of sheet.items) {
    labels.push({
      key: `i-${item.id}`,
      title: item.name,
      caption: labelCaption(item),
      meta: PART_CATEGORY_LABELS[item.category],
      qr: await qrSvg(partLabelUrl("line", item.qrToken), {
        size: MIN_LABEL_QR_PX,
      }),
    });
    for (const unit of item.units) {
      labels.push({
        key: `u-${unit.id}`,
        title: item.name,
        caption: labelCaption({ ...item, serial: unit.serial }),
        meta: unit.expiresOn
          ? `Expires ${unit.expiresOn.toISOString().slice(0, 10)}`
          : "Individual part",
        qr: await qrSvg(partLabelUrl("unit", unit.qrToken), {
          size: MIN_LABEL_QR_PX,
        }),
      });
    }
  }

  const sheets = intoSheets(labels);

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <header className="space-y-2 print:hidden">
        <Link
          href={`/teams/${slug}/manage?tab=garage`}
          className="text-sm text-brand-red hover:underline"
        >
          ← {team.name} garage
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">Part labels</h1>
            <p className="text-sm text-brand-black/60">
              {labels.length} label{labels.length === 1 ? "" : "s"} across{" "}
              {sheets.length} sheet{sheets.length === 1 ? "" : "s"}. Sized for
              three-across 63.5mm address stock, so they peel straight onto a
              bin.
            </p>
          </div>
          <PrintButton />
        </div>
        <p className="text-xs text-brand-black/50">
          Do not scale this down to fit more on a page — the code is already at
          the smallest size that reads reliably on a phone in a dim trailer.
        </p>
      </header>

      {labels.length === 0 ? (
        <p className="text-sm text-brand-black/60">
          Nothing on the shelf yet. Add stock in the garage and the labels
          appear here.
        </p>
      ) : (
        sheets.map((page, index) => (
          <div
            key={index}
            className="grid gap-2 break-after-page"
            style={{
              gridTemplateColumns: `repeat(${LABELS_PER_ROW}, minmax(0, 1fr))`,
            }}
          >
            {page.map((label) => (
              <div
                key={label.key}
                className="flex items-center gap-2 rounded border border-brand-black/20 p-2"
              >
                <div
                  className="h-[92px] w-[92px] shrink-0 [&>svg]:h-full [&>svg]:w-full"
                  dangerouslySetInnerHTML={{ __html: label.qr }}
                />
                <div className="min-w-0">
                  {/* Two lines and no more. A 63mm label at arm's length in a
                      dim trailer holds a name and one identifying line before
                      it stops being readable at all. */}
                  <p className="truncate text-sm font-semibold leading-tight">
                    {label.title}
                  </p>
                  {label.caption && (
                    <p className="truncate text-xs text-brand-black/70">
                      {label.caption}
                    </p>
                  )}
                  {label.meta && (
                    <p className="truncate text-[10px] uppercase tracking-wide text-brand-black/45">
                      {label.meta}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        ))
      )}
    </div>
  );
}
