"use client";

import { useRef, useState } from "react";
import { api } from "@/lib/trpc/client";
import { formatLapTime } from "@/lib/lap-time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const SAMPLE = `Pos,Car,Team,Laps,Best Lap,Status
1,24,Apex Racing,58,1:23.456,Finished
2,7,Northline Motorsport,58,1:23.900,Finished
3,11,Vertex GT,55,1:25.100,DNF`;

/**
 * Bulk results import. The organizer pastes or uploads a timing export, sees
 * a dry-run of exactly what would change, then commits.
 */
export function ResultsImportPanel({ eventId }: { eventId: string }) {
  const utils = api.useUtils();
  const [payload, setPayload] = useState("");
  const [submitted, setSubmitted] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const preview = api.event.previewResultsImport.useQuery(
    { eventId, payload: submitted ?? "" },
    { enabled: Boolean(submitted), retry: false },
  );

  const runImport = api.event.importResults.useMutation({
    meta: { silenceError: true },
    onSuccess: () => {
      setPayload("");
      setSubmitted(null);
      utils.event.resultsFor.invalidate({ eventId });
      utils.series.standings.invalidate();
    },
  });

  async function onFile(file: File) {
    const text = await file.text();
    setPayload(text);
    setSubmitted(null);
  }

  const plan = preview.data;
  const blocking = (plan?.conflicts.length ?? 0) > 0;

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-xl font-semibold">Import results</h2>
        <p className="text-sm text-brand-black/60">
          Paste or upload a CSV/TSV or JSON export from your timing system.
          Entries are matched on car number, falling back to competitor name.
        </p>
      </div>

      <Card>
        <CardContent className="space-y-4 p-5">
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInput}
              type="file"
              accept=".csv,.tsv,.txt,.json,text/csv,application/json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void onFile(file);
              }}
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => fileInput.current?.click()}
            >
              Choose file
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setPayload(SAMPLE);
                setSubmitted(null);
              }}
            >
              Use sample
            </Button>
          </div>

          <label className="block text-sm font-medium">
            Results data
            <textarea
              className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 font-mono text-xs"
              rows={8}
              value={payload}
              onChange={(e) => {
                setPayload(e.target.value);
                setSubmitted(null);
              }}
              placeholder={SAMPLE}
            />
          </label>

          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={!payload.trim()}
              onClick={() => setSubmitted(payload)}
            >
              Preview import
            </Button>
            {plan && !blocking && plan.matched.length > 0 && (
              <Button
                variant="primary"
                disabled={runImport.isPending}
                onClick={() =>
                  runImport.mutate({ eventId, payload: submitted! })
                }
              >
                {runImport.isPending
                  ? "Importing…"
                  : `Import ${plan.matched.length} result${plan.matched.length === 1 ? "" : "s"}`}
              </Button>
            )}
          </div>

          {preview.error && (
            <p className="text-sm text-brand-red">{preview.error.message}</p>
          )}
          {runImport.error && (
            <p className="text-sm text-brand-red">{runImport.error.message}</p>
          )}
          {runImport.isSuccess && (
            <p className="text-sm text-green-700">
              Imported {runImport.data.imported} result
              {runImport.data.imported === 1 ? "" : "s"}.
            </p>
          )}

          {preview.isFetching && (
            <p className="text-sm text-brand-black/60">Checking…</p>
          )}

          {plan && (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <Badge variant="verified">{plan.matched.length} matched</Badge>
                {plan.unmatched.length > 0 && (
                  <Badge>{plan.unmatched.length} unmatched</Badge>
                )}
                {plan.issues.length > 0 && (
                  <Badge>{plan.issues.length} row issue(s)</Badge>
                )}
                {plan.conflicts.length > 0 && (
                  <Badge>{plan.conflicts.length} conflict(s)</Badge>
                )}
              </div>

              {plan.conflicts.length > 0 && (
                <div className="rounded-lg border border-brand-red/30 bg-brand-red/5 p-3">
                  <p className="text-sm font-semibold text-brand-red">
                    Resolve these before importing
                  </p>
                  <ul className="mt-1 space-y-1 text-sm">
                    {plan.conflicts.map((conflict, i) => (
                      <li key={i}>
                        Row {conflict.rowNumber}: {conflict.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {plan.issues.length > 0 && (
                <div className="rounded-lg border border-brand-black/10 p-3">
                  <p className="text-sm font-semibold">Skipped rows</p>
                  <ul className="mt-1 space-y-1 text-sm text-brand-black/70">
                    {plan.issues.map((issue, i) => (
                      <li key={i}>
                        Row {issue.rowNumber}: {issue.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {plan.unmatched.length > 0 && (
                <p className="text-sm text-brand-black/70">
                  No confirmed entry for:{" "}
                  {plan.unmatched.map((u) => u.label).join(", ")}
                </p>
              )}

              {plan.matched.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[520px] text-sm">
                    <thead className="border-b border-brand-black/10 text-left text-xs uppercase text-brand-black/60">
                      <tr>
                        <th className="p-2">Pos</th>
                        <th className="p-2">Competitor</th>
                        <th className="p-2">Status</th>
                        <th className="p-2 text-right">Laps</th>
                        <th className="p-2 text-right">Best lap</th>
                        <th className="p-2">Matched on</th>
                      </tr>
                    </thead>
                    <tbody>
                      {plan.matched.map((row) => (
                        <tr
                          key={row.registrationId}
                          className="border-b border-brand-black/5 last:border-0"
                        >
                          <td className="p-2 font-semibold">
                            {row.finishPosition ?? "—"}
                          </td>
                          <td className="p-2">
                            {row.competitorLabel}
                            {row.fastestLap && (
                              <span className="ml-2 text-xs text-brand-red">
                                FL
                              </span>
                            )}
                          </td>
                          <td className="p-2">{row.status}</td>
                          <td className="p-2 text-right">
                            {row.lapsCompleted}
                          </td>
                          <td className="p-2 text-right font-mono text-xs">
                            {formatLapTime(row.bestLapMs)}
                          </td>
                          <td className="p-2 text-xs text-brand-black/60">
                            {row.matchedOn === "carNumber"
                              ? "car number"
                              : "name"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
