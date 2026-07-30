"use client";

import { useState } from "react";
import {
  AppealStatus,
  PenaltyType,
  ResultStatus,
} from "@prisma/client";
import type { inferRouterOutputs } from "@trpc/server";
import { api } from "@/lib/trpc/client";
import { RESULT_STATUS_LABELS } from "@/lib/standings";
import type { AppRouter } from "@/server/trpc/root";
import {
  APPEAL_STATUS_LABELS,
  PENALTY_STATUS_LABELS,
  PENALTY_TYPE_LABELS,
  describePenalty,
  isAppealOpen,
  requiredMagnitudeField,
} from "@/lib/penalties";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { MediaPanel } from "@/components/media-panel";

/** Classify confirmed entries so the championship can be scored. */
export function ResultsPanel({ eventId }: { eventId: string }) {
  const utils = api.useUtils();
  const registrations = api.event.registrationsFor.useQuery({ eventId });
  const results = api.event.resultsFor.useQuery({ eventId });
  const record = api.event.recordResult.useMutation({
    onSuccess: () => {
      utils.event.resultsFor.invalidate({ eventId });
    },
  });

  const confirmed =
    registrations.data?.filter((r) => r.status === "CONFIRMED") ?? [];
  const resultByRegistration = new Map(
    (results.data ?? []).map((r) => [r.registrationId, r]),
  );

  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold">Results</h2>
      {confirmed.length === 0 && (
        <p className="text-brand-black/60">
          Confirm entries before recording results.
        </p>
      )}
      <div className="space-y-2">
        {confirmed.map((registration) => (
          <ResultRow
            key={registration.id}
            registration={registration}
            existing={resultByRegistration.get(registration.id)}
            onSave={(input) => record.mutate(input)}
            saving={record.isPending}
          />
        ))}
      </div>
      {record.error && (
        <p className="text-sm text-brand-red">{record.error.message}</p>
      )}
    </section>
  );
}

type RouterOutputs = inferRouterOutputs<AppRouter>;
type Registration = RouterOutputs["event"]["registrationsFor"][number];
type ExistingResult = RouterOutputs["event"]["resultsFor"][number];

function ResultRow({
  registration,
  existing,
  onSave,
  saving,
}: {
  registration: Registration;
  existing?: ExistingResult;
  onSave: (input: {
    registrationId: string;
    finishPosition?: number | null;
    status: ResultStatus;
    fastestLap: boolean;
  }) => void;
  saving: boolean;
}) {
  const [position, setPosition] = useState(
    existing?.finishPosition?.toString() ?? "",
  );
  const [status, setStatus] = useState<ResultStatus>(
    existing?.status ?? ResultStatus.FINISHED,
  );
  const [fastestLap, setFastestLap] = useState(existing?.fastestLap ?? false);

  const label =
    registration.team?.name ??
    registration.entrantUser?.profile?.displayName ??
    "Entry";

  return (
    <Card>
      <CardContent className="flex flex-wrap items-end gap-3 p-4">
        <div className="min-w-[10rem] flex-1">
          <p className="font-medium">
            {registration.carNumber ? `#${registration.carNumber} ` : ""}
            {label}
          </p>
          <p className="text-xs text-brand-black/60">
            {registration.carClass ?? "—"}
          </p>
        </div>
        <label className="text-sm font-medium">
          Pos
          <input
            type="number"
            min={1}
            className="mt-1 w-20 rounded-md border border-brand-black/20 px-2 py-2 text-sm"
            value={position}
            onChange={(e) => setPosition(e.target.value)}
          />
        </label>
        <label className="text-sm font-medium">
          Status
          <select
            className="mt-1 rounded-md border border-brand-black/20 px-2 py-2 text-sm"
            value={status}
            onChange={(e) => setStatus(e.target.value as ResultStatus)}
          >
            {Object.values(ResultStatus).map((s) => (
              <option key={s} value={s}>
                {RESULT_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={fastestLap}
            onChange={(e) => setFastestLap(e.target.checked)}
          />
          FL
        </label>
        <Button
          size="sm"
          variant="primary"
          disabled={saving}
          onClick={() =>
            onSave({
              registrationId: registration.id,
              finishPosition: position ? Number(position) : null,
              status,
              fastestLap,
            })
          }
        >
          {existing ? "Update" : "Save"}
        </Button>
      </CardContent>
    </Card>
  );
}

/** Issue penalties and rule on appeals. */
export function PenaltiesPanel({ eventId }: { eventId: string }) {
  const utils = api.useUtils();
  const registrations = api.event.registrationsFor.useQuery({ eventId });
  const penalties = api.penalty.forEvent.useQuery({ eventId });
  const [showForm, setShowForm] = useState(false);

  const invalidate = () => {
    utils.penalty.forEvent.invalidate({ eventId });
    utils.event.resultsFor.invalidate({ eventId });
  };
  const issue = api.penalty.issue.useMutation({
    onSuccess: () => {
      setShowForm(false);
      invalidate();
    },
  });

  const [registrationId, setRegistrationId] = useState("");
  const [type, setType] = useState<PenaltyType>(PenaltyType.TIME_PENALTY);
  const [summary, setSummary] = useState("");
  const [details, setDetails] = useState("");
  const [regulation, setRegulation] = useState("");
  const [lapNumber, setLapNumber] = useState("");
  const [magnitude, setMagnitude] = useState("");

  const magnitudeField = requiredMagnitudeField(type);
  const confirmed =
    registrations.data?.filter((r) => r.status === "CONFIRMED") ?? [];

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-semibold">Penalties</h2>
        <Button
          size="sm"
          variant="primary"
          onClick={() => setShowForm((v) => !v)}
        >
          {showForm ? "Cancel" : "Issue penalty"}
        </Button>
      </div>

      {showForm && (
        <Card className="max-w-2xl">
          <CardContent className="space-y-4 p-5">
            <label className="block text-sm font-medium">
              Entry
              <select
                className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
                value={registrationId}
                onChange={(e) => setRegistrationId(e.target.value)}
              >
                <option value="">Select an entry…</option>
                {confirmed.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.carNumber ? `#${r.carNumber} ` : ""}
                    {r.team?.name ??
                      r.entrantUser?.profile?.displayName ??
                      "Entry"}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm font-medium">
                Penalty
                <select
                  className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
                  value={type}
                  onChange={(e) => setType(e.target.value as PenaltyType)}
                >
                  {Object.values(PenaltyType).map((t) => (
                    <option key={t} value={t}>
                      {PENALTY_TYPE_LABELS[t]}
                    </option>
                  ))}
                </select>
              </label>
              {magnitudeField && (
                <label className="block text-sm font-medium">
                  {magnitudeField === "timeSeconds"
                    ? "Seconds"
                    : magnitudeField === "gridPlaces"
                      ? "Grid places"
                      : "Points deducted"}
                  <input
                    type="number"
                    min={1}
                    className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
                    value={magnitude}
                    onChange={(e) => setMagnitude(e.target.value)}
                  />
                </label>
              )}
              <label className="block text-sm font-medium">
                Regulation
                <input
                  className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
                  value={regulation}
                  onChange={(e) => setRegulation(e.target.value)}
                  placeholder="27.4"
                />
              </label>
              <label className="block text-sm font-medium">
                Lap
                <input
                  type="number"
                  min={0}
                  className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
                  value={lapNumber}
                  onChange={(e) => setLapNumber(e.target.value)}
                />
              </label>
            </div>
            <label className="block text-sm font-medium">
              Summary
              <input
                className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                placeholder="Causing a collision at Turn 4"
              />
            </label>
            <label className="block text-sm font-medium">
              Decision detail
              <textarea
                className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
                rows={3}
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                placeholder="The stewards reviewed video evidence and determined…"
              />
            </label>
            {issue.error && (
              <p className="text-sm text-brand-red">{issue.error.message}</p>
            )}
            <Button
              variant="primary"
              disabled={
                issue.isPending || !registrationId || summary.trim().length < 3
              }
              onClick={() =>
                issue.mutate({
                  registrationId,
                  type,
                  summary: summary.trim(),
                  details: details.trim() || undefined,
                  regulation: regulation.trim() || undefined,
                  lapNumber: lapNumber ? Number(lapNumber) : undefined,
                  ...(magnitudeField && magnitude
                    ? { [magnitudeField]: Number(magnitude) }
                    : {}),
                })
              }
            >
              {issue.isPending ? "Issuing…" : "Issue penalty"}
            </Button>
          </CardContent>
        </Card>
      )}

      {penalties.data?.length === 0 && (
        <p className="text-brand-black/60">No penalties issued.</p>
      )}
      <div className="space-y-3">
        {penalties.data?.map((penalty) => (
          <PenaltyAdminCard
            key={penalty.id}
            penalty={penalty}
            onChanged={invalidate}
          />
        ))}
      </div>
    </section>
  );
}

type EventPenalty = RouterOutputs["penalty"]["forEvent"][number];

function PenaltyAdminCard({
  penalty,
  onChanged,
}: {
  penalty: EventPenalty;
  onChanged: () => void;
}) {
  const [decision, setDecision] = useState("");
  const [reducedPoints, setReducedPoints] = useState("");

  const decide = api.penalty.decideAppeal.useMutation({
    onSuccess: () => {
      setDecision("");
      setReducedPoints("");
      onChanged();
    },
  });
  const rescind = api.penalty.rescind.useMutation({ onSuccess: onChanged });

  const competitor =
    penalty.registration.team?.name ??
    penalty.registration.entrantUser?.profile?.displayName ??
    "Entry";
  const appealOpen = penalty.appeal && isAppealOpen(penalty.appeal.status);

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="font-medium">
              {penalty.registration.carNumber
                ? `#${penalty.registration.carNumber} `
                : ""}
              {competitor}
            </p>
            <p className="text-xs text-brand-black/60">
              {describePenalty(penalty)} · {penalty.summary}
            </p>
          </div>
          <Badge
            variant={penalty.status === "OVERTURNED" ? "default" : "verified"}
          >
            {PENALTY_STATUS_LABELS[penalty.status]}
          </Badge>
        </div>

        {penalty.status === "ISSUED" && (
          <Button
            size="sm"
            variant="ghost"
            disabled={rescind.isPending}
            onClick={() => rescind.mutate({ penaltyId: penalty.id })}
          >
            Rescind
          </Button>
        )}

        <MediaPanel
          scope={{ penaltyId: penalty.id }}
          title="Supporting evidence"
          description="Footage or telemetry backing this decision."
          canManage
          allowOrganizerOnly
        />

        {penalty.appeal && (
          <div className="rounded-lg border border-brand-black/10 bg-brand-black/[0.02] p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold">Appeal</p>
              <Badge>{APPEAL_STATUS_LABELS[penalty.appeal.status]}</Badge>
            </div>
            <p className="mt-1 whitespace-pre-wrap text-sm text-brand-black/80">
              {penalty.appeal.statement}
            </p>
            {penalty.appeal.decision && (
              <p className="mt-2 whitespace-pre-wrap text-sm">
                <span className="font-medium">Decision: </span>
                {penalty.appeal.decision}
              </p>
            )}

            {appealOpen && (
              <div className="mt-3 space-y-2">
                <label className="block text-sm font-medium">
                  Steward decision
                  <textarea
                    className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
                    rows={3}
                    value={decision}
                    onChange={(e) => setDecision(e.target.value)}
                    placeholder="Reasoning for the panel's ruling…"
                  />
                </label>
                {penalty.pointsDeducted !== null && (
                  <label className="block text-sm font-medium">
                    Reduce deduction to (optional)
                    <input
                      type="number"
                      min={0}
                      className="mt-1 w-32 rounded-md border border-brand-black/20 px-3 py-2 text-sm"
                      value={reducedPoints}
                      onChange={(e) => setReducedPoints(e.target.value)}
                      placeholder={String(penalty.pointsDeducted)}
                    />
                  </label>
                )}
                {decide.error && (
                  <p className="text-xs text-brand-red">
                    {decide.error.message}
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={decide.isPending || decision.trim().length < 10}
                    onClick={() =>
                      decide.mutate({
                        appealId: penalty.appeal!.id,
                        outcome: AppealStatus.UPHELD,
                        decision: decision.trim(),
                        ...(reducedPoints
                          ? { reducedPointsDeducted: Number(reducedPoints) }
                          : {}),
                      })
                    }
                  >
                    Uphold appeal
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={decide.isPending || decision.trim().length < 10}
                    onClick={() =>
                      decide.mutate({
                        appealId: penalty.appeal!.id,
                        outcome: AppealStatus.REJECTED,
                        decision: decision.trim(),
                      })
                    }
                  >
                    Reject appeal
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
