"use client";

import { useState } from "react";
import Link from "next/link";
import { CredentialAudience } from "@prisma/client";
import { api } from "@/lib/trpc/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AUDIENCE_DESCRIPTIONS,
  AUDIENCE_LABELS,
  holderSubtitle,
  zoneSummary,
} from "@/lib/credentials";

/**
 * Issuing everyone's pass in one go.
 *
 * The preview is not a nicety. Naming two hundred people is the moment
 * accreditation stops being a spreadsheet, and a button that does it silently
 * is one an organizer presses once and then never trusts again — so this shows
 * exactly who would get what, and who would get nothing, before anything is
 * written.
 *
 * The "nobody is issuing these" list matters most. A driver who matches no
 * configured pass type is a driver who turns up on Saturday morning with
 * nothing, and who would otherwise never appear in any error message.
 */
export function CredentialGenerator({
  eventId,
  onChanged,
}: {
  eventId: string;
  onChanged: () => void;
}) {
  const utils = api.useUtils();
  const [open, setOpen] = useState(false);
  const preview = api.paddock.previewCredentialSweep.useQuery(
    { eventId },
    { enabled: open },
  );
  const generate = api.paddock.generateCredentials.useMutation({
    onSuccess: async () => {
      await utils.paddock.previewCredentialSweep.invalidate({ eventId });
      onChanged();
    },
  });

  const plan = preview.data?.plan;
  const types = preview.data?.types ?? [];
  const configured = types.filter((type) => type.autoIssueTo);

  return (
    <div className="space-y-3 rounded-lg border border-brand-black/15 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium">Generate passes</p>
          <p className="text-xs text-brand-black/60">
            Names everyone entered, volunteering or organizing, and gives each
            of them a pass with a QR code.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setOpen((value) => !value)}
        >
          {open ? "Close" : "Review"}
        </Button>
      </div>

      {open && (
        <div className="space-y-3 border-t border-brand-black/10 pt-3">
          {preview.isLoading && (
            <p className="text-sm text-brand-black/60">Working out who…</p>
          )}

          {preview.data && configured.length === 0 && (
            <p className="text-sm text-brand-black/70">
              No pass type is set to be generated for anyone yet. Edit a pass
              type and choose who it is for — drivers, entrants, volunteers or
              organizers — and this will fill in.
            </p>
          )}

          {configured.length > 0 && (
            <p className="flex flex-wrap gap-2 text-xs">
              {configured.map((type) => (
                <span
                  key={type.id}
                  className="rounded bg-brand-black/5 px-2 py-1"
                >
                  <span className="font-medium">
                    {AUDIENCE_LABELS[type.autoIssueTo as CredentialAudience]}
                  </span>{" "}
                  → {type.name}
                  {zoneSummary(type.zones) ? ` (${zoneSummary(type.zones)})` : ""}
                </span>
              ))}
            </p>
          )}

          {plan && (
            <>
              <p className="text-sm">
                <span className="font-medium">{plan.toIssue.length}</span> to
                issue
                {plan.alreadyHeld > 0 && (
                  <span className="text-brand-black/60">
                    {" "}
                    · {plan.alreadyHeld} already hold one
                  </span>
                )}
              </p>

              {plan.toIssue.length > 0 && (
                <ul className="max-h-56 space-y-1 overflow-y-auto rounded border border-brand-black/10 p-2 text-xs">
                  {plan.toIssue.map((entry, index) => (
                    <li
                      key={`${entry.credentialTypeId}-${entry.candidate.userId ?? entry.candidate.name}-${index}`}
                      className="flex flex-wrap items-baseline justify-between gap-2"
                    >
                      <span>
                        <span className="font-medium">
                          {entry.candidate.name}
                        </span>
                        {holderSubtitle(entry.candidate) && (
                          <span className="text-brand-black/55">
                            {" "}
                            · {holderSubtitle(entry.candidate)}
                          </span>
                        )}
                      </span>
                      <Badge variant="outline">{entry.credentialTypeName}</Badge>
                    </li>
                  ))}
                </ul>
              )}

              {plan.unmatched.length > 0 && (
                <div className="rounded border border-brand-red/30 bg-brand-red/5 p-3 text-xs">
                  <p className="font-medium text-brand-red">
                    {plan.unmatched.length} {plan.unmatched.length === 1 ? "person" : "people"} would get nothing
                  </p>
                  <p className="mt-0.5 text-brand-black/70">
                    No pass type is set to be generated for{" "}
                    {[
                      ...new Set(
                        plan.unmatched.map(
                          (candidate) => AUDIENCE_LABELS[candidate.audience],
                        ),
                      ),
                    ].join(", ")}
                    . They will arrive with no pass unless you add one.
                  </p>
                  <ul className="mt-1.5 space-y-0.5 text-brand-black/60">
                    {plan.unmatched.slice(0, 6).map((candidate, index) => (
                      <li key={`${candidate.userId ?? candidate.name}-${index}`}>
                        {candidate.name} — {AUDIENCE_DESCRIPTIONS[candidate.audience]}
                      </li>
                    ))}
                    {plan.unmatched.length > 6 && (
                      <li>…and {plan.unmatched.length - 6} more.</li>
                    )}
                  </ul>
                </div>
              )}

              {generate.error && (
                <p className="text-sm text-brand-red">
                  {generate.error.message}
                </p>
              )}

              <div className="flex flex-wrap items-center gap-3">
                <Button
                  size="sm"
                  variant="primary"
                  disabled={plan.toIssue.length === 0 || generate.isPending}
                  onClick={() => generate.mutate({ eventId })}
                >
                  {generate.isPending
                    ? "Issuing…"
                    : `Issue ${plan.toIssue.length} pass${plan.toIssue.length === 1 ? "" : "es"}`}
                </Button>
                <Link
                  href={`/events/${eventId}/print/credentials`}
                  className="text-xs text-brand-red hover:underline"
                >
                  Print the badges →
                </Link>
              </div>

              {generate.data && (
                <p className="text-sm text-brand-black/70">
                  Issued {generate.data.created}. Print them, cut them out and
                  hand them over — each carries a QR code that shows the
                  holder&rsquo;s name, entry, role and access when scanned.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
