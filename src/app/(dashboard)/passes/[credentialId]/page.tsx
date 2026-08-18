import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { TRPCError } from "@trpc/server";
import { serverApi } from "@/server/trpc/server-caller";
import { Badge } from "@/components/ui/badge";
import { PrintButton } from "@/components/print-button";
import { ACCESS_ZONE_LABELS, sortZones } from "@/lib/credentials";
import { eventVenueLabel } from "@/lib/tracks";
import { credentialUrl, qrSvg } from "@/server/services/qr";

/**
 * One pass, for the person it belongs to.
 *
 * Built for a phone held up at a gate: the QR is the largest thing on the
 * screen, and everything a marshal might ask sits under it in the order they
 * ask it. It also prints — the print stylesheet drops the site chrome and
 * leaves a card that goes in a lanyard, because plenty of paddocks have no
 * signal and plenty of people would rather not hand over their phone.
 */

export const metadata: Metadata = {
  title: "Your pass · RaceOps",
  robots: { index: false, follow: false },
};

export default async function PassDetailPage({
  params,
}: {
  params: Promise<{ credentialId: string }>;
}) {
  const { credentialId } = await params;
  const api = await serverApi();

  let pass;
  try {
    pass = await api.paddock.myCredential({ credentialId });
  } catch (error) {
    if (
      error instanceof TRPCError &&
      (error.code === "NOT_FOUND" || error.code === "BAD_REQUEST")
    ) {
      notFound();
    }
    throw error;
  }

  const zones = sortZones(pass.credentialType.zones);
  const venue = eventVenueLabel(pass.event);
  // Rendered on the server so the page works the moment it loads, on a phone
  // that may lose signal between the car park and the gate.
  const qr = pass.qrToken ? await qrSvg(credentialUrl(pass.qrToken), { size: 320 }) : null;

  return (
    <div className="print-document mx-auto max-w-md space-y-5">
      <div className="print:hidden">
        <Link href="/home" className="text-sm text-brand-red hover:underline">
          ← Your passes
        </Link>
      </div>

      <article className="space-y-4 rounded-xl border-2 border-brand-black/70 p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-brand-red">
              {pass.credentialType.name}
            </p>
            <h1 className="text-2xl font-bold leading-tight">
              {pass.holderName}
            </h1>
            <p className="text-sm text-brand-black/70">
              {pass.holderRole ?? "Role not given"}
            </p>
          </div>
          {pass.registration?.carNumber && (
            <p className="text-3xl font-bold tabular-nums">
              #{pass.registration.carNumber}
            </p>
          )}
        </div>

        {qr ? (
          <div
            className="mx-auto w-full max-w-[320px] [&>svg]:h-auto [&>svg]:w-full"
            dangerouslySetInnerHTML={{ __html: qr }}
          />
        ) : (
          <p className="rounded border border-dashed border-brand-black/30 p-4 text-center text-sm text-brand-black/60">
            This pass has no code yet. Ask the organizers to re-issue it.
          </p>
        )}

        <dl className="space-y-1.5 text-sm">
          {pass.registration?.team?.name && (
            <Row label="Team" value={pass.registration.team.name} />
          )}
          {pass.registration?.carClass && (
            <Row label="Class" value={pass.registration.carClass} />
          )}
          {pass.serial && <Row label="Serial" value={pass.serial} />}
        </dl>

        <div className="space-y-1.5 border-t border-brand-black/15 pt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-black/50">
            Access
          </p>
          {zones.length > 0 ? (
            <ul className="flex flex-wrap gap-1.5">
              {zones.map((zone) => (
                <li key={zone}>
                  <Badge variant="verified">{ACCESS_ZONE_LABELS[zone]}</Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-brand-black/60">
              No areas recorded on this pass type.
            </p>
          )}
          {pass.credentialType.description && (
            <p className="text-xs text-brand-black/70">
              {pass.credentialType.description}
            </p>
          )}
        </div>

        <div className="border-t border-brand-black/15 pt-3 text-sm">
          <p className="font-medium">{pass.event.name}</p>
          <p className="text-brand-black/60">
            {[
              pass.event.series?.name,
              venue,
              new Date(pass.event.date).toLocaleDateString(undefined, {
                weekday: "short",
                day: "numeric",
                month: "short",
                year: "numeric",
              }),
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
      </article>

      <div className="flex flex-wrap items-center gap-3 print:hidden">
        {pass.walletAvailable ? (
          <a
            href={`/api/passes/${pass.id}`}
            className="inline-flex items-center gap-2 rounded-md bg-brand-black px-4 py-2.5 text-sm font-medium text-on-ink hover:bg-brand-black/85"
          >
            Add to Apple Wallet
          </a>
        ) : (
          <p className="text-xs text-brand-black/55">
            Apple Wallet is not set up on this deployment — print the pass or
            keep this page open instead. It works offline once loaded.
          </p>
        )}
        <PrintButton />
        <Link
          href={`/events/${pass.event.id}`}
          className="text-sm text-brand-red hover:underline"
        >
          Event page →
        </Link>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <dt className="text-xs font-semibold uppercase tracking-wide text-brand-black/50">
        {label}
      </dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
