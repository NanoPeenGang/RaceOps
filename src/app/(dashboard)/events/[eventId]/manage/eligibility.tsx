"use client";

import { useState } from "react";
import { api } from "@/lib/trpc/client";
import { REQUIREMENT_KIND_LABELS } from "@/lib/eligibility";
import type { EligibilityState } from "@/lib/eligibility";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const STATE_LABELS: Record<EligibilityState, string> = {
  met: "Met",
  not_met: "Not met",
  needs_signoff: "Needs sign-off",
  waived: "Signed off",
  refused: "Refused",
};

/** Red for anything standing in the way, muted for anything already settled. */
const STATE_STYLES: Record<EligibilityState, string> = {
  met: "text-green-700",
  not_met: "text-brand-red",
  needs_signoff: "text-yellow-700",
  waived: "text-green-700",
  refused: "text-brand-red",
};

/**
 * The eligibility desk: every entry checked against the series' requirements,
 * per declared driver, with sign-off in place.
 */
export function EligibilityPanel({ eventId }: { eventId: string }) {
  const utils = api.useUtils();
  const rows = api.eligibility.forEvent.useQuery({ eventId }, { retry: false });
  const [open, setOpen] = useState<string | null>(null);

  const refresh = () => {
    utils.eligibility.forEvent.invalidate({ eventId });
    utils.eligibility.forRegistration.invalidate();
  };
  const decide = api.eligibility.decide.useMutation({ onSuccess: refresh });
  const clear = api.eligibility.clearDecision.useMutation({
    onSuccess: refresh,
  });

  if (rows.error) {
    return (
      <section className="space-y-2">
        <h2 className="text-xl font-semibold">Entry eligibility</h2>
        <p className="text-sm text-brand-black/60">{rows.error.message}</p>
      </section>
    );
  }

  const data = rows.data ?? [];
  const withRequirements = data.filter((row) => row.findings.length > 0);

  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold">Entry eligibility</h2>

      {rows.isLoading && <p className="text-brand-black/60">Loading…</p>}
      {!rows.isLoading && withRequirements.length === 0 && (
        <p className="text-brand-black/60">
          {data.length === 0
            ? "No entries yet."
            : "This series sets no entry requirements, so nothing is checked."}
        </p>
      )}

      <div className="space-y-2">
        {withRequirements.map((row) => (
          <Card
            key={row.registrationId}
            className={row.eligible ? undefined : "border-brand-red/40"}
          >
            <CardContent className="space-y-3 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium">
                    {row.carNumber ? `#${row.carNumber} ` : ""}
                    {row.label}
                  </p>
                  <p className="text-xs text-brand-black/60">{row.summary}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={row.eligible ? "verified" : "default"}>
                    {row.eligible ? "Eligible" : "Outstanding"}
                  </Badge>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setOpen((current) =>
                        current === row.registrationId
                          ? null
                          : row.registrationId,
                      )
                    }
                  >
                    {open === row.registrationId ? "Close" : "Review"}
                  </Button>
                </div>
              </div>

              {open === row.registrationId && (
                <div className="space-y-2 border-t border-brand-black/10 pt-3">
                  {row.findings.map((finding) => (
                    <div
                      key={`${finding.requirementId}-${finding.userId}`}
                      className="flex flex-wrap items-center justify-between gap-2 text-sm"
                    >
                      <div className="min-w-0">
                        <p>
                          <span className="font-medium">
                            {finding.driverName}
                          </span>{" "}
                          — {finding.requirementLabel}
                          <span className="ml-2 text-xs text-brand-black/50">
                            {REQUIREMENT_KIND_LABELS[finding.kind]}
                            {finding.enforcement === "ADVISORY"
                              ? " · advisory"
                              : ""}
                          </span>
                        </p>
                        <p
                          className={`text-xs ${STATE_STYLES[finding.state]}`}
                        >
                          {STATE_LABELS[finding.state]} — {finding.detail}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        {finding.state === "waived" ||
                        finding.state === "refused" ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={clear.isPending}
                            onClick={() =>
                              clear.mutate({
                                requirementId: finding.requirementId,
                                registrationId: row.registrationId,
                                userId: finding.userId,
                              })
                            }
                          >
                            Undo
                          </Button>
                        ) : (
                          <>
                            <Button
                              size="sm"
                              variant="primary"
                              disabled={decide.isPending}
                              onClick={() =>
                                decide.mutate({
                                  requirementId: finding.requirementId,
                                  registrationId: row.registrationId,
                                  userId: finding.userId,
                                  granted: true,
                                })
                              }
                            >
                              Sign off
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={decide.isPending}
                              onClick={() =>
                                decide.mutate({
                                  requirementId: finding.requirementId,
                                  registrationId: row.registrationId,
                                  userId: finding.userId,
                                  granted: false,
                                })
                              }
                            >
                              Refuse
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {(decide.error ?? clear.error) && (
        <p className="text-sm text-brand-red">
          {decide.error?.message ?? clear.error?.message}
        </p>
      )}
    </section>
  );
}
