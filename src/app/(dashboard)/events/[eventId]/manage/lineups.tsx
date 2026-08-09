"use client";

import { useState } from "react";
import { api } from "@/lib/trpc/client";
import { formatDriveTime } from "@/lib/lineup";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { LineupPanel } from "@/components/lineup-panel";
import { PitStopPlanner } from "@/components/pit-stop-planner";

/**
 * Race control's view of endurance line-ups: the drive-time regulations for the
 * event, a compliance list across every confirmed entry, and the ability to
 * open any one entry's crew and stint log.
 */
export function LineupsPanel({ eventId }: { eventId: string }) {
  const compliance = api.lineup.complianceForEvent.useQuery(
    { eventId },
    { retry: false },
  );
  const [openEntry, setOpenEntry] = useState<string | null>(null);

  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold">Line-ups & drive time</h2>

      <DriveTimeRulesForm eventId={eventId} />

      {compliance.isLoading && <p className="text-brand-black/60">Loading…</p>}
      {compliance.error && (
        <p className="text-sm text-brand-red">{compliance.error.message}</p>
      )}
      {compliance.data?.length === 0 && (
        <p className="text-brand-black/60">
          No confirmed entries yet — line-ups appear here once entries are
          accepted.
        </p>
      )}

      <div className="space-y-2">
        {compliance.data?.map((row) => (
          <Card
            key={row.registrationId}
            className={row.breachCount > 0 ? "border-brand-red/40" : undefined}
          >
            <CardContent className="space-y-3 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium">
                    {row.carNumber ? `#${row.carNumber} ` : ""}
                    {row.teamName ?? "Entry"}
                  </p>
                  {row.violations.length > 0 && (
                    <p className="text-xs text-brand-black/60">
                      {row.violations[0].message}
                      {row.violations.length > 1
                        ? ` (+${row.violations.length - 1} more)`
                        : ""}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={row.breachCount > 0 ? "default" : "verified"}>
                    {row.breachCount > 0
                      ? `${row.breachCount} breach${row.breachCount === 1 ? "" : "es"}`
                      : "Compliant"}
                  </Badge>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setOpenEntry((current) =>
                        current === row.registrationId
                          ? null
                          : row.registrationId,
                      )
                    }
                  >
                    {openEntry === row.registrationId ? "Close" : "Open"}
                  </Button>
                </div>
              </div>

              {openEntry === row.registrationId && (
                <div className="space-y-6 border-t border-brand-black/10 pt-3">
                  <LineupPanel
                    registrationId={row.registrationId}
                    canManage
                    title="Crew"
                  />
                  {/* Organizers read the plan and cannot change it — a team's
                      stop strategy is theirs. The server enforces that; this
                      just shows it. */}
                  <PitStopPlanner
                    registrationId={row.registrationId}
                    title="Pit stop plan"
                  />
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}

/** Event-level drive-time regulations. Left blank for a sprint round. */
function DriveTimeRulesForm({ eventId }: { eventId: string }) {
  const utils = api.useUtils();
  const event = api.event.byId.useQuery({ eventId });
  const [open, setOpen] = useState(false);

  const setRules = api.lineup.setRules.useMutation({
    meta: { silenceError: true },
    onSuccess: () => {
      setOpen(false);
      utils.event.byId.invalidate({ eventId });
      utils.lineup.complianceForEvent.invalidate({ eventId });
    },
  });

  const current = event.data;
  const [values, setValues] = useState<Record<string, string>>({});

  const field = (
    key:
      | "minDriversPerEntry"
      | "maxDriversPerEntry"
      | "minStintMinutes"
      | "maxStintMinutes"
      | "minDriveMinutesPerDriver"
      | "maxDriveMinutesPerDriver",
  ) =>
    values[key] ??
    (current?.[key] === null ? "" : String(current?.[key] ?? ""));

  const numeric = (raw: string) =>
    raw.trim() === "" ? null : Number(raw) || null;

  if (!open) {
    const summary = [
      current?.minDriversPerEntry != null &&
        `min ${current.minDriversPerEntry} drivers`,
      current?.maxDriversPerEntry != null &&
        `max ${current.maxDriversPerEntry} drivers`,
      current?.maxStintMinutes != null &&
        `stint ≤ ${current.maxStintMinutes} min`,
      current?.maxDriveMinutesPerDriver != null &&
        `≤ ${formatDriveTime(current.maxDriveMinutesPerDriver)} each`,
    ].filter(Boolean);

    return (
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
          {summary.length > 0
            ? "Edit drive-time rules"
            : "Set drive-time rules"}
        </Button>
        <p className="text-xs text-brand-black/60">
          {summary.length > 0
            ? summary.join(" · ")
            : "No line-up regulations — this event is treated as a single-driver round."}
        </p>
      </div>
    );
  }

  return (
    <Card className="max-w-2xl">
      <CardContent className="space-y-4 p-5">
        <p className="text-xs text-brand-black/60">
          Leave a field blank to leave that rule unenforced. Times are in
          minutes.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          {(
            [
              ["minDriversPerEntry", "Minimum drivers"],
              ["maxDriversPerEntry", "Maximum drivers"],
              ["minStintMinutes", "Minimum stint (min)"],
              ["maxStintMinutes", "Maximum stint (min)"],
              ["minDriveMinutesPerDriver", "Min drive time per driver (min)"],
              ["maxDriveMinutesPerDriver", "Max drive time per driver (min)"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="block text-sm font-medium">
              {label}
              <input
                inputMode="numeric"
                className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
                value={field(key)}
                onChange={(e) =>
                  setValues((prev) => ({ ...prev, [key]: e.target.value }))
                }
              />
            </label>
          ))}
        </div>
        {setRules.error && (
          <p className="text-sm text-brand-red">{setRules.error.message}</p>
        )}
        <div className="flex gap-2">
          <Button
            variant="primary"
            disabled={setRules.isPending}
            onClick={() =>
              setRules.mutate({
                eventId,
                minDriversPerEntry: numeric(field("minDriversPerEntry")),
                maxDriversPerEntry: numeric(field("maxDriversPerEntry")),
                minStintMinutes: numeric(field("minStintMinutes")),
                maxStintMinutes: numeric(field("maxStintMinutes")),
                minDriveMinutesPerDriver: numeric(
                  field("minDriveMinutesPerDriver"),
                ),
                maxDriveMinutesPerDriver: numeric(
                  field("maxDriveMinutesPerDriver"),
                ),
              })
            }
          >
            {setRules.isPending ? "Saving…" : "Save rules"}
          </Button>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
