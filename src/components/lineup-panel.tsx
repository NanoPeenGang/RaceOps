"use client";

import { useState } from "react";
import { LineupRole } from "@prisma/client";
import { api } from "@/lib/trpc/client";
import {
  LINEUP_ROLE_LABELS,
  driveTimeByDriver,
  formatDriveTime,
  hasDriveTimeRules,
} from "@/lib/lineup";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ListSkeleton } from "@/components/ui/skeleton";

/**
 * An entry's declared crew and their time in the car.
 *
 * Used by the team console and by race control against the same endpoints —
 * the server decides who may edit, so this component only decides what to show.
 */
export function LineupPanel({
  registrationId,
  canManage,
  title = "Driver line-up",
}: {
  registrationId: string;
  canManage: boolean;
  title?: string;
}) {
  const utils = api.useUtils();
  const lineup = api.lineup.forRegistration.useQuery(
    { registrationId },
    { meta: { silenceError: true } },
  );
  const [showAdd, setShowAdd] = useState(false);
  const [driverQuery, setDriverQuery] = useState("");
  const [pendingUserId, setPendingUserId] = useState("");
  const [role, setRole] = useState<LineupRole>(LineupRole.DRIVER);
  const [grade, setGrade] = useState("");

  // Drivers are added by searching existing profiles — a line-up entry has to
  // point at a real account so drive time and eligibility attach to someone.
  const candidates = api.search.profiles.useQuery(
    { query: driverQuery, limit: 8 },
    { enabled: showAdd && driverQuery.trim().length >= 2 },
  );

  const refresh = () => {
    utils.lineup.forRegistration.invalidate({ registrationId });
    utils.lineup.complianceForEvent.invalidate();
  };
  const addDriver = api.lineup.addDriver.useMutation({
    onSuccess: () => {
      setShowAdd(false);
      setDriverQuery("");
      setPendingUserId("");
      setGrade("");
      refresh();
    },
  });
  const setDriverRole = api.lineup.setDriverRole.useMutation({
    onSuccess: refresh,
  });
  const removeDriver = api.lineup.removeDriver.useMutation({
    onSuccess: refresh,
  });
  const startStint = api.lineup.startStint.useMutation({ onSuccess: refresh });
  const endStint = api.lineup.endStint.useMutation({ onSuccess: refresh });

  if (lineup.isLoading) return <ListSkeleton />;
  if (lineup.error)
    return <p className="text-sm text-brand-red">{lineup.error.message}</p>;

  const { lineup: crew, stints, rules, violations } = lineup.data!;
  const driveTime = driveTimeByDriver(
    stints.map((stint) => ({
      id: stint.id,
      lineupDriverId: stint.lineupDriverId,
      startedAt: new Date(stint.startedAt),
      endedAt: stint.endedAt ? new Date(stint.endedAt) : null,
    })),
  );
  const openStint = stints.find((stint) => stint.endedAt === null);
  const regulated = hasDriveTimeRules(rules);
  const mutationError =
    addDriver.error ??
    setDriverRole.error ??
    removeDriver.error ??
    startStint.error ??
    endStint.error;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-xl font-semibold">{title}</h2>
          {regulated && <RulesSummary rules={rules} />}
        </div>
        {canManage && (
          <Button
            size="sm"
            variant="primary"
            onClick={() => setShowAdd((v) => !v)}
          >
            {showAdd ? "Cancel" : "Add driver"}
          </Button>
        )}
      </div>

      {violations.length > 0 && (
        <Card
          className={
            violations.some((v) => v.severity === "breach")
              ? "border-brand-red/40 bg-brand-red/5"
              : "border-yellow-500/40 bg-yellow-50"
          }
        >
          <CardContent className="space-y-1 p-4 text-sm">
            {violations.map((violation, index) => (
              <p
                key={`${violation.code}-${index}`}
                className={
                  violation.severity === "breach"
                    ? "text-brand-red"
                    : "text-brand-black/70"
                }
              >
                {violation.severity === "pending" ? "Outstanding: " : ""}
                {violation.message}
              </p>
            ))}
          </CardContent>
        </Card>
      )}

      {showAdd && canManage && (
        <Card className="max-w-2xl">
          <CardContent className="space-y-4 p-5">
            <label className="block text-sm font-medium">
              Find the driver
              <input
                className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
                value={driverQuery}
                onChange={(e) => {
                  setDriverQuery(e.target.value);
                  setPendingUserId("");
                }}
                placeholder="Search by name"
              />
            </label>

            {driverQuery.trim().length >= 2 && (
              <div className="space-y-1">
                {candidates.isLoading && (
                  <p className="text-xs text-brand-black/60">Searching…</p>
                )}
                {candidates.data?.users.length === 0 && (
                  <p className="text-xs text-brand-black/60">
                    No profiles match. They need a RaceOps account before they
                    can be declared on an entry.
                  </p>
                )}
                {candidates.data?.users.map((user) => (
                  <button
                    key={user.id}
                    type="button"
                    onClick={() => setPendingUserId(user.id)}
                    className={`block w-full rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                      pendingUserId === user.id
                        ? "border-brand-red bg-brand-red/5"
                        : "border-brand-black/15 hover:border-brand-red/50"
                    }`}
                  >
                    {user.profile?.displayName ?? "Unnamed"}
                    {user.profile?.location && (
                      <span className="ml-2 text-xs text-brand-black/60">
                        {user.profile.location}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm font-medium">
                Role
                <select
                  className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
                  value={role}
                  onChange={(e) => setRole(e.target.value as LineupRole)}
                >
                  {Object.values(LineupRole).map((option) => (
                    <option key={option} value={option}>
                      {LINEUP_ROLE_LABELS[option]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm font-medium">
                Grade <span className="text-brand-black/50">(optional)</span>
                <input
                  className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
                  value={grade}
                  onChange={(e) => setGrade(e.target.value)}
                  placeholder="Bronze · Am · Novice"
                />
              </label>
            </div>

            <Button
              variant="primary"
              disabled={addDriver.isPending || !pendingUserId}
              onClick={() =>
                addDriver.mutate({
                  registrationId,
                  userId: pendingUserId,
                  role,
                  grade: grade.trim() || undefined,
                })
              }
            >
              {addDriver.isPending ? "Adding…" : "Add to line-up"}
            </Button>
          </CardContent>
        </Card>
      )}

      {crew.length === 0 ? (
        <p className="text-brand-black/60">
          No drivers declared yet.
          {regulated
            ? " This event has drive-time regulations, so the crew has to be declared before the entry is compliant."
            : ""}
        </p>
      ) : (
        <div className="space-y-2">
          {crew.map((entry) => {
            const drive = driveTime.get(entry.id);
            return (
              <Card key={entry.id}>
                <CardContent className="space-y-2 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium">
                        {entry.user.profile?.displayName ?? "Unnamed"}
                        {drive?.inCar && (
                          <span className="ml-2 text-xs font-semibold text-brand-red">
                            ● in car
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-brand-black/60">
                        {[
                          LINEUP_ROLE_LABELS[entry.role],
                          entry.grade,
                          drive &&
                            `${formatDriveTime(drive.totalMinutes)} over ${drive.stintCount} stint${drive.stintCount === 1 ? "" : "s"}`,
                          drive &&
                            `longest ${formatDriveTime(drive.longestStintMinutes)}`,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                    {entry.role === LineupRole.DRIVER_OF_RECORD && (
                      <Badge variant="verified">Driver of record</Badge>
                    )}
                  </div>

                  {canManage && (
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        className="rounded-md border border-brand-black/20 px-2 py-1.5 text-xs"
                        value={entry.role}
                        disabled={setDriverRole.isPending}
                        onChange={(e) =>
                          setDriverRole.mutate({
                            lineupDriverId: entry.id,
                            role: e.target.value as LineupRole,
                          })
                        }
                      >
                        {Object.values(LineupRole).map((option) => (
                          <option key={option} value={option}>
                            {LINEUP_ROLE_LABELS[option]}
                          </option>
                        ))}
                      </select>
                      {drive?.inCar ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={endStint.isPending || !openStint}
                          onClick={() =>
                            openStint &&
                            endStint.mutate({ stintId: openStint.id })
                          }
                        >
                          End stint
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="primary"
                          disabled={startStint.isPending}
                          onClick={() =>
                            startStint.mutate({ lineupDriverId: entry.id })
                          }
                        >
                          Start stint
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={removeDriver.isPending}
                        onClick={() =>
                          removeDriver.mutate({ lineupDriverId: entry.id })
                        }
                      >
                        Remove
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {mutationError && (
        <p className="text-sm text-brand-red">{mutationError.message}</p>
      )}

      {stints.length > 0 && (
        <details className="rounded-md border border-brand-black/10 p-3">
          <summary className="cursor-pointer text-sm font-medium text-brand-black/70">
            Stint log ({stints.length})
          </summary>
          <div className="mt-3 space-y-1.5 text-sm">
            {stints.map((stint) => {
              const driver = crew.find((c) => c.id === stint.lineupDriverId);
              return (
                <div
                  key={stint.id}
                  className="flex flex-wrap items-center justify-between gap-2"
                >
                  <span>
                    {driver?.user.profile?.displayName ?? "Unattributed"}
                  </span>
                  <span className="text-xs text-brand-black/60">
                    {new Date(stint.startedAt).toLocaleTimeString(undefined, {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                    {" – "}
                    {stint.endedAt
                      ? new Date(stint.endedAt).toLocaleTimeString(undefined, {
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : "running"}
                    {stint.laps !== null ? ` · ${stint.laps} laps` : ""}
                  </span>
                </div>
              );
            })}
          </div>
        </details>
      )}
    </section>
  );
}

function RulesSummary({
  rules,
}: {
  rules: {
    minDriversPerEntry?: number | null;
    maxDriversPerEntry?: number | null;
    maxStintMinutes?: number | null;
    minStintMinutes?: number | null;
    maxDriveMinutesPerDriver?: number | null;
    minDriveMinutesPerDriver?: number | null;
  };
}) {
  const parts = [
    rules.minDriversPerEntry != null &&
      rules.maxDriversPerEntry != null &&
      `${rules.minDriversPerEntry}–${rules.maxDriversPerEntry} drivers`,
    rules.minDriversPerEntry != null &&
      rules.maxDriversPerEntry == null &&
      `min ${rules.minDriversPerEntry} drivers`,
    rules.maxDriversPerEntry != null &&
      rules.minDriversPerEntry == null &&
      `max ${rules.maxDriversPerEntry} drivers`,
    rules.maxStintMinutes != null && `stint ≤ ${rules.maxStintMinutes} min`,
    rules.minStintMinutes != null && `stint ≥ ${rules.minStintMinutes} min`,
    rules.maxDriveMinutesPerDriver != null &&
      `≤ ${formatDriveTime(rules.maxDriveMinutesPerDriver)} each`,
    rules.minDriveMinutesPerDriver != null &&
      `≥ ${formatDriveTime(rules.minDriveMinutesPerDriver)} each`,
  ].filter(Boolean);

  return (
    <p className="mt-1 text-xs text-brand-black/60">{parts.join(" · ")}</p>
  );
}
