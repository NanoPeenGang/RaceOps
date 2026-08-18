import Link from "next/link";
import type { Metadata } from "next";
import { TRPCError } from "@trpc/server";
import { serverApi } from "@/server/trpc/server-caller";
import { Badge } from "@/components/ui/badge";
import {
  ACCESS_ZONE_LABELS,
  invalidReason,
  isValidPass,
  sortZones,
} from "@/lib/credentials";
import { CREDENTIAL_STATUS_LABELS } from "@/lib/paddock";

/**
 * What a marshal sees after scanning a pass.
 *
 * Designed for one situation: somebody standing at a gate holding a phone in
 * one hand, with a queue behind the person in front of them. So the verdict is
 * the first and largest thing on the page, in a colour readable at arm's
 * length, and the detail that justifies it comes underneath. Nothing here is
 * interactive — there is no decision to make in the UI, only one to make about
 * the person.
 *
 * Public by design. A gate marshal at 07:00 has no reason to hold a RaceOps
 * account, and a check that only works when signed in is a check nobody
 * performs. What the page shows is exactly what the badge already prints, so
 * holding the link grants nothing that holding the pass does not.
 */

export const metadata: Metadata = {
  title: "Pass · RaceOps",
  // A pass link should never end up in a search index.
  robots: { index: false, follow: false },
};

export default async function PassPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const api = await serverApi();

  let pass;
  try {
    pass = await api.paddock.scanCredential({ token });
  } catch (error) {
    if (error instanceof TRPCError && error.code === "NOT_FOUND") {
      return <Verdict tone="unknown" headline="Not a pass we issued" />;
    }
    if (error instanceof TRPCError && error.code === "BAD_REQUEST") {
      return <Verdict tone="unknown" headline="That code is not readable" />;
    }
    throw error;
  }

  const valid = isValidPass(pass.status);
  const zones = sortZones(pass.credentialType.zones);
  const entrant =
    pass.registration?.team?.name ??
    pass.registration?.entrantUser?.profile?.displayName ??
    null;

  return (
    <main className="mx-auto max-w-md space-y-5 p-5">
      <Verdict
        tone={valid ? "valid" : "invalid"}
        headline={valid ? "Valid pass" : "Do not admit"}
        detail={
          valid
            ? CREDENTIAL_STATUS_LABELS[pass.status]
            : (invalidReason(pass.status) ??
              CREDENTIAL_STATUS_LABELS[pass.status])
        }
      />

      <section className="space-y-1">
        <h1 className="text-3xl font-bold leading-tight">{pass.holderName}</h1>
        <p className="text-lg text-brand-black/70">
          {pass.holderRole ?? "Role not given"}
        </p>
      </section>

      <section className="space-y-3 rounded-lg border border-brand-black/10 p-4">
        <Row label="Pass" value={pass.credentialType.name} />
        {entrant && (
          <Row
            label="Team / entrant"
            value={
              pass.registration?.carNumber
                ? `#${pass.registration.carNumber} — ${entrant}`
                : entrant
            }
          />
        )}
        {pass.registration?.carClass && (
          <Row label="Class" value={pass.registration.carClass} />
        )}
        {pass.serial && <Row label="Serial" value={pass.serial} />}
      </section>

      <section className="space-y-2">
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
          /*
           * An empty list must not read as "no restrictions". A pass whose
           * zones nobody filled in tells a gate marshal nothing, and saying so
           * is the only safe rendering.
           */
          <p className="text-sm text-brand-black/60">
            No areas recorded on this pass type. Check with race control before
            admitting to a restricted area.
          </p>
        )}
        {pass.credentialType.description && (
          <p className="text-sm text-brand-black/70">
            {pass.credentialType.description}
          </p>
        )}
      </section>

      <section className="border-t border-brand-black/10 pt-4 text-sm text-brand-black/60">
        <p className="font-medium text-brand-black/80">{pass.event.name}</p>
        <p>
          {[
            pass.event.series?.name,
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
        <Link
          href={`/events/${pass.event.id}`}
          className="mt-2 inline-block text-xs text-brand-red hover:underline"
        >
          Event page →
        </Link>
      </section>
    </main>
  );
}

/** The answer, at arm's length. */
function Verdict({
  tone,
  headline,
  detail,
}: {
  tone: "valid" | "invalid" | "unknown";
  headline: string;
  detail?: string;
}) {
  const styles = {
    valid: "bg-green-600 text-white",
    invalid: "bg-brand-red text-on-red",
    unknown: "bg-brand-black text-on-ink",
  }[tone];

  return (
    <div className={`rounded-lg p-5 text-center ${styles}`}>
      <p className="text-2xl font-bold">{headline}</p>
      {detail && <p className="mt-1 text-sm opacity-90">{detail}</p>}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <span className="text-xs font-semibold uppercase tracking-wide text-brand-black/50">
        {label}
      </span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  );
}
