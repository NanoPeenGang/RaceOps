"use client";

import { useState } from "react";
import { RequirementEnforcement, RequirementKind } from "@prisma/client";
import { api } from "@/lib/trpc/client";
import {
  ENFORCEMENT_LABELS,
  REQUIREMENT_KIND_LABELS,
} from "@/lib/eligibility";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Entry requirements: what a driver must satisfy to take part.
 *
 * Scoped series-wide or to one class, because a fast class routinely demands a
 * higher licence than the novice class in the same championship.
 */
export function RequirementsPanel({
  seriesId,
  canManage,
}: {
  seriesId: string;
  canManage: boolean;
}) {
  const utils = api.useUtils();
  const requirements = api.eligibility.forSeries.useQuery({ seriesId });
  const classes = api.series.classes.useQuery({ seriesId });
  const [showForm, setShowForm] = useState(false);

  const [kind, setKind] = useState<RequirementKind>(RequirementKind.CREDENTIAL);
  const [label, setLabel] = useState("");
  const [classId, setClassId] = useState("");
  const [enforcement, setEnforcement] = useState<RequirementEnforcement>(
    RequirementEnforcement.BLOCKING,
  );
  const [credentialKind, setCredentialKind] = useState("FIA_LICENSE");
  const [simPlatform, setSimPlatform] = useState("iracing");
  const [minRating, setMinRating] = useState("");
  const [minAge, setMinAge] = useState("");

  const refresh = () => {
    utils.eligibility.forSeries.invalidate({ seriesId });
    utils.eligibility.forEvent.invalidate();
  };
  const create = api.eligibility.create.useMutation({
    onSuccess: () => {
      setShowForm(false);
      setLabel("");
      refresh();
    },
  });
  const update = api.eligibility.update.useMutation({ onSuccess: refresh });
  const remove = api.eligibility.remove.useMutation({ onSuccess: refresh });

  const rows = requirements.data ?? [];
  const error = create.error ?? update.error ?? remove.error;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-xl font-semibold">Entry requirements</h2>
          <p className="mt-1 text-xs text-brand-black/60">
            {rows.length === 0
              ? "No requirements — anyone can enter."
              : "Checked against every declared driver before an entry is confirmed."}
          </p>
        </div>
        {canManage && (
          <Button
            size="sm"
            variant="primary"
            onClick={() => setShowForm((v) => !v)}
          >
            {showForm ? "Cancel" : "Add requirement"}
          </Button>
        )}
      </div>

      {showForm && canManage && (
        <Card className="max-w-2xl">
          <CardContent className="space-y-4 p-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm font-medium">
                Type
                <select
                  className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
                  value={kind}
                  onChange={(e) => setKind(e.target.value as RequirementKind)}
                >
                  {Object.values(RequirementKind).map((option) => (
                    <option key={option} value={option}>
                      {REQUIREMENT_KIND_LABELS[option]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm font-medium">
                Label
                <input
                  className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="National A licence"
                />
              </label>

              {kind === RequirementKind.CREDENTIAL && (
                <label className="block text-sm font-medium">
                  Credential kind
                  <input
                    className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
                    value={credentialKind}
                    onChange={(e) => setCredentialKind(e.target.value)}
                    placeholder="FIA_LICENSE"
                  />
                </label>
              )}
              {kind === RequirementKind.SIM_RATING && (
                <>
                  <label className="block text-sm font-medium">
                    Platform
                    <input
                      className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
                      value={simPlatform}
                      onChange={(e) => setSimPlatform(e.target.value)}
                      placeholder="iracing"
                    />
                  </label>
                  <label className="block text-sm font-medium">
                    Minimum rating
                    <input
                      inputMode="numeric"
                      className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
                      value={minRating}
                      onChange={(e) => setMinRating(e.target.value)}
                      placeholder="2000"
                    />
                  </label>
                </>
              )}
              {kind === RequirementKind.MIN_AGE && (
                <label className="block text-sm font-medium">
                  Minimum age
                  <input
                    inputMode="numeric"
                    className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
                    value={minAge}
                    onChange={(e) => setMinAge(e.target.value)}
                    placeholder="16"
                  />
                </label>
              )}

              <label className="block text-sm font-medium">
                Applies to
                <select
                  className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
                  value={classId}
                  onChange={(e) => setClassId(e.target.value)}
                >
                  <option value="">Every class</option>
                  {classes.data?.map((seriesClass) => (
                    <option key={seriesClass.id} value={seriesClass.id}>
                      {seriesClass.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm font-medium">
                Enforcement
                <select
                  className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
                  value={enforcement}
                  onChange={(e) =>
                    setEnforcement(e.target.value as RequirementEnforcement)
                  }
                >
                  {Object.values(RequirementEnforcement).map((option) => (
                    <option key={option} value={option}>
                      {ENFORCEMENT_LABELS[option]}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {create.error && (
              <p className="text-sm text-brand-red">{create.error.message}</p>
            )}
            <Button
              variant="primary"
              disabled={create.isPending || label.trim().length < 2}
              onClick={() =>
                create.mutate({
                  seriesId,
                  seriesClassId: classId || null,
                  kind,
                  label: label.trim(),
                  enforcement,
                  credentialKind:
                    kind === RequirementKind.CREDENTIAL
                      ? credentialKind.trim() || undefined
                      : undefined,
                  simPlatform:
                    kind === RequirementKind.SIM_RATING
                      ? simPlatform.trim() || undefined
                      : undefined,
                  minRating:
                    kind === RequirementKind.SIM_RATING && minRating.trim()
                      ? Number(minRating)
                      : undefined,
                  minAge:
                    kind === RequirementKind.MIN_AGE && minAge.trim()
                      ? Number(minAge)
                      : undefined,
                })
              }
            >
              {create.isPending ? "Adding…" : "Add requirement"}
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="space-y-2">
        {rows.map((requirement) => {
          const scope = classes.data?.find(
            (c) => c.id === requirement.seriesClassId,
          );
          return (
            <Card key={requirement.id}>
              <CardContent className="flex flex-wrap items-center justify-between gap-2 p-4">
                <div>
                  <p className="font-medium">{requirement.label}</p>
                  <p className="text-xs text-brand-black/60">
                    {[
                      REQUIREMENT_KIND_LABELS[requirement.kind],
                      scope ? scope.name : "every class",
                      ENFORCEMENT_LABELS[requirement.enforcement],
                      requirement.credentialKind,
                      requirement.minRating !== null &&
                        `${requirement.simPlatform} ≥ ${requirement.minRating}`,
                      requirement.minAge !== null && `${requirement.minAge}+`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {!requirement.active && <Badge>Retired</Badge>}
                  {canManage && (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={update.isPending}
                        onClick={() =>
                          update.mutate({
                            requirementId: requirement.id,
                            active: !requirement.active,
                          })
                        }
                      >
                        {requirement.active ? "Retire" : "Reinstate"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={remove.isPending}
                        onClick={() =>
                          remove.mutate({ requirementId: requirement.id })
                        }
                      >
                        Delete
                      </Button>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {error && <p className="text-sm text-brand-red">{error.message}</p>}
    </section>
  );
}
