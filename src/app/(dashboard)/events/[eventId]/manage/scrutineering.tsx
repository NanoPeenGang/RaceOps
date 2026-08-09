"use client";

import { useState } from "react";
import { CheckResult, InspectionStage } from "@prisma/client";
import { api } from "@/lib/trpc/client";
import {
  CHECK_RESULT_LABELS,
  INSPECTION_STAGE_LABELS,
  INSPECTION_STATUS_LABELS,
  blocksRunning,
  currentInspection,
  formatTolerance,
  isMeasured,
  summarizeInspection,
} from "@/lib/scrutineering";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/**
 * The scrutineering bay: every car's technical standing, with a card that can
 * be worked through check by check and a re-check after a failure.
 */
export function ScrutineeringPanel({
  eventId,
  seriesId,
}: {
  eventId: string;
  seriesId: string | null;
}) {
  const utils = api.useUtils();
  const entries = api.scrutineering.forEvent.useQuery(
    { eventId },
    { retry: false },
  );
  const templates = api.scrutineering.templates.useQuery(
    { seriesId: seriesId ?? "" },
    { enabled: Boolean(seriesId) },
  );
  const [openEntry, setOpenEntry] = useState<string | null>(null);
  const [stage, setStage] = useState<InspectionStage>(
    InspectionStage.PRE_EVENT,
  );
  const [templateId, setTemplateId] = useState("");

  const refresh = () => utils.scrutineering.forEvent.invalidate({ eventId });
  const open = api.scrutineering.open.useMutation({
    meta: { silenceError: true },
    onSuccess: refresh,
  });

  if (entries.error) {
    return (
      <section className="space-y-2">
        <h2 className="text-xl font-semibold">Scrutineering</h2>
        <p className="text-sm text-brand-black/60">{entries.error.message}</p>
      </section>
    );
  }

  const rows = entries.data ?? [];

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-semibold">Scrutineering</h2>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="rounded-md border border-brand-black/20 px-2 py-1.5 text-xs"
            value={stage}
            onChange={(e) => setStage(e.target.value as InspectionStage)}
          >
            {Object.values(InspectionStage).map((option) => (
              <option key={option} value={option}>
                {INSPECTION_STAGE_LABELS[option]}
              </option>
            ))}
          </select>
          <select
            className="rounded-md border border-brand-black/20 px-2 py-1.5 text-xs"
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
          >
            <option value="">Blank card</option>
            {templates.data?.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {rows.length === 0 && (
        <p className="text-brand-black/60">No entries to inspect yet.</p>
      )}

      <div className="space-y-2">
        {rows.map((entry) => {
          const inspections = entry.inspections.map((inspection) => ({
            ...inspection,
            createdAt: new Date(inspection.createdAt),
          }));
          const current = currentInspection(inspections, stage);
          const label =
            entry.team?.name ??
            entry.entrantUser?.profile?.displayName ??
            "Entry";

          return (
            <Card
              key={entry.id}
              className={
                current && blocksRunning(current.status)
                  ? "border-brand-red/40"
                  : undefined
              }
            >
              <CardContent className="space-y-3 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium">
                      {entry.carNumber ? `#${entry.carNumber} ` : ""}
                      {label}
                    </p>
                    <p className="text-xs text-brand-black/60">
                      {[
                        entry.carClass,
                        current
                          ? summarizeInspection(current.checks)
                          : "Not inspected",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {current && (
                      <Badge
                        variant={
                          current.status === "PASSED" ? "verified" : "default"
                        }
                      >
                        {INSPECTION_STATUS_LABELS[current.status]}
                      </Badge>
                    )}
                    {current ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setOpenEntry((c) =>
                            c === entry.id ? null : entry.id,
                          )
                        }
                      >
                        {openEntry === entry.id ? "Close" : "Open card"}
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="primary"
                        disabled={open.isPending}
                        onClick={() =>
                          open.mutate({
                            registrationId: entry.id,
                            stage,
                            templateId: templateId || undefined,
                          })
                        }
                      >
                        Start card
                      </Button>
                    )}
                  </div>
                </div>

                {openEntry === entry.id && current && (
                  <InspectionCard
                    inspectionId={current.id}
                    registrationId={entry.id}
                    checks={current.checks}
                    status={current.status}
                    onChanged={refresh}
                    templateId={templateId || undefined}
                    stage={stage}
                  />
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {open.error && (
        <p className="text-sm text-brand-red">{open.error.message}</p>
      )}
    </section>
  );
}

type CheckRow = {
  id: string;
  label: string;
  regulation: string | null;
  measureUnit: string | null;
  minValue: number | null;
  maxValue: number | null;
  result: CheckResult;
  measuredValue: number | null;
};

function InspectionCard({
  inspectionId,
  registrationId,
  checks,
  status,
  onChanged,
  templateId,
  stage,
}: {
  inspectionId: string;
  registrationId: string;
  checks: CheckRow[];
  status: string;
  onChanged: () => void;
  templateId?: string;
  stage: InspectionStage;
}) {
  const record = api.scrutineering.recordCheck.useMutation({
    onSuccess: onChanged,
  });
  const refer = api.scrutineering.refer.useMutation({
    meta: { successMessage: "Referred to the stewards." },
    onSuccess: onChanged,
  });
  const raise = api.scrutineering.raisePenalty.useMutation({
    meta: { successMessage: "Referred to the stewards." },
    onSuccess: onChanged,
  });
  const openRecheck = api.scrutineering.open.useMutation({
    onSuccess: onChanged,
  });
  const [measurements, setMeasurements] = useState<Record<string, string>>({});

  const error = record.error ?? refer.error ?? raise.error ?? openRecheck.error;
  const failed = checks.some((c) => c.result === CheckResult.FAIL);

  return (
    <div className="space-y-3 border-t border-brand-black/10 pt-3">
      {checks.length === 0 && (
        <p className="text-sm text-brand-black/60">
          This card has no checks. Pick a template before starting a card, or
          add checks as you go.
        </p>
      )}

      {checks.map((check) => (
        <div
          key={check.id}
          className="flex flex-wrap items-center justify-between gap-2 text-sm"
        >
          <div className="min-w-0">
            <p className="font-medium">{check.label}</p>
            <p className="text-xs text-brand-black/60">
              {[
                check.regulation,
                isMeasured(check) ? formatTolerance(check) : null,
                check.measuredValue !== null
                  ? `measured ${check.measuredValue}${check.measureUnit ?? ""}`
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {isMeasured(check) && (
              <input
                className="w-24 rounded-md border border-brand-black/20 px-2 py-1.5 text-xs"
                inputMode="decimal"
                placeholder={check.measureUnit ?? "value"}
                value={
                  measurements[check.id] ??
                  (check.measuredValue === null
                    ? ""
                    : String(check.measuredValue))
                }
                onChange={(e) =>
                  setMeasurements((prev) => ({
                    ...prev,
                    [check.id]: e.target.value,
                  }))
                }
                onBlur={(e) => {
                  const raw = e.target.value.trim();
                  if (raw === "") return;
                  const value = Number(raw);
                  if (Number.isNaN(value)) return;
                  // The tolerance decides pass/fail; no verdict is sent.
                  record.mutate({ checkId: check.id, measuredValue: value });
                }}
              />
            )}
            <span
              className={`w-16 text-right text-xs font-medium ${
                check.result === CheckResult.FAIL
                  ? "text-brand-red"
                  : check.result === CheckResult.PASS
                    ? "text-green-700"
                    : "text-brand-black/50"
              }`}
            >
              {CHECK_RESULT_LABELS[check.result]}
            </span>
            {(
              [
                CheckResult.PASS,
                CheckResult.FAIL,
                CheckResult.NOT_APPLICABLE,
              ] as const
            ).map((option) => (
              <Button
                key={option}
                size="sm"
                variant={check.result === option ? "primary" : "outline"}
                disabled={record.isPending}
                onClick={() =>
                  record.mutate({ checkId: check.id, result: option })
                }
              >
                {CHECK_RESULT_LABELS[option]}
              </Button>
            ))}
          </div>
        </div>
      ))}

      <div className="flex flex-wrap gap-2 pt-1">
        {failed && (
          <>
            <Button
              size="sm"
              variant="outline"
              disabled={openRecheck.isPending}
              onClick={() =>
                openRecheck.mutate({
                  registrationId,
                  templateId,
                  stage,
                  supersedesId: inspectionId,
                })
              }
            >
              Start re-check
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={raise.isPending}
              onClick={() => raise.mutate({ inspectionId })}
            >
              Raise penalty
            </Button>
          </>
        )}
        {status !== "REFERRED" && (
          <Button
            size="sm"
            variant="ghost"
            disabled={refer.isPending}
            onClick={() => refer.mutate({ inspectionId })}
          >
            Refer to stewards
          </Button>
        )}
      </div>

      {error && <p className="text-sm text-brand-red">{error.message}</p>}
    </div>
  );
}
