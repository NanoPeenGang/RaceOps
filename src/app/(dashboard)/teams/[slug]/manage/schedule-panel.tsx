"use client";

import { useState } from "react";
import Link from "next/link";
import { api } from "@/lib/trpc/client";
import { EVENT_STATUS_LABELS, REGISTRATION_STATUS_LABELS } from "@/lib/events";
import { isTeamManager } from "@/lib/teams";
import { splitSchedule } from "@/lib/team-season";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { LineupPanel } from "@/components/lineup-panel";
import { PitStopPlanner } from "@/components/pit-stop-planner";
import type { TeamDashboard } from "./types";

/**
 * The team's calendar and its entries — the same records seen two ways. An
 * entry *is* the team's place on a race weekend, so the schedule is built from
 * registrations rather than kept separately.
 */
export function SchedulePanel({
  team,
  onChanged,
}: {
  team: TeamDashboard;
  onChanged: () => void;
}) {
  const canManage = isTeamManager(team.myRole);
  const [openLineup, setOpenLineup] = useState<string | null>(null);
  const withdraw = api.event.withdrawRegistration.useMutation({
    meta: { silenceError: true, successMessage: "Entry withdrawn." },
    onSuccess: onChanged,
  });

  const entries = team.registrations.map((registration) => ({
    ...registration,
    date: new Date(registration.event.date),
  }));
  const { upcoming, past } = splitSchedule(entries);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-semibold">Schedule & entries</h2>
        <Link href="/events">
          <Button size="sm" variant="outline">
            Find events to enter
          </Button>
        </Link>
      </div>

      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-brand-black/50">
          Coming up ({upcoming.length})
        </h3>
        {upcoming.length === 0 ? (
          <p className="text-sm text-brand-black/60">
            No entries on the books. Enter a race from the events page — the
            entry shows up here.
          </p>
        ) : (
          upcoming.map((entry) => (
            <Card key={entry.id}>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <Link
                    href={`/events/${entry.event.id}`}
                    className="font-medium hover:text-brand-red"
                  >
                    {entry.event.name}
                  </Link>
                  <p className="text-xs text-brand-black/60">
                    {[
                      entry.event.series?.name,
                      entry.event.venue,
                      entry.date.toLocaleDateString(undefined, {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                      }),
                      entry.carNumber && `#${entry.carNumber}`,
                      entry.carClass,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant={
                      entry.status === "CONFIRMED" ? "verified" : "default"
                    }
                  >
                    {REGISTRATION_STATUS_LABELS[entry.status]}
                  </Badge>
                  <Link href={`/events/${entry.event.id}/timing`}>
                    <Button size="sm" variant="outline">
                      Timing
                    </Button>
                  </Link>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setOpenLineup((current) =>
                        current === entry.id ? null : entry.id,
                      )
                    }
                  >
                    {openLineup === entry.id ? "Hide crew" : "Crew"}
                  </Button>
                  {canManage && entry.status !== "WITHDRAWN" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={withdraw.isPending}
                      onClick={() =>
                        withdraw.mutate({ registrationId: entry.id })
                      }
                    >
                      Withdraw
                    </Button>
                  )}
                </div>

                {openLineup === entry.id && (
                  <div className="w-full space-y-6 border-t border-brand-black/10 pt-3">
                    <LineupPanel
                      registrationId={entry.id}
                      canManage={canManage}
                      title="Driver line-up"
                    />
                    <PitStopPlanner registrationId={entry.id} />
                  </div>
                )}
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {past.length > 0 && (
        <details className="rounded-md border border-brand-black/10 p-3">
          <summary className="cursor-pointer text-sm font-medium text-brand-black/70">
            Past entries ({past.length})
          </summary>
          <div className="mt-3 space-y-1.5 text-sm">
            {past.map((entry) => (
              <div
                key={entry.id}
                className="flex flex-wrap items-center justify-between gap-2"
              >
                <Link
                  href={`/events/${entry.event.id}`}
                  className="hover:text-brand-red"
                >
                  {entry.event.name}
                </Link>
                <span className="text-xs text-brand-black/60">
                  {entry.date.toLocaleDateString()} ·{" "}
                  {EVENT_STATUS_LABELS[entry.event.status]} ·{" "}
                  {REGISTRATION_STATUS_LABELS[entry.status]}
                </span>
              </div>
            ))}
          </div>
        </details>
      )}

      {withdraw.error && (
        <p className="text-sm text-brand-red">{withdraw.error.message}</p>
      )}
    </section>
  );
}
