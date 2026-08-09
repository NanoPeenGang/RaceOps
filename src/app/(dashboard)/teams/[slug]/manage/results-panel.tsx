"use client";

import Link from "next/link";
import { api } from "@/lib/trpc/client";
import { RESULT_STATUS_LABELS } from "@/lib/standings";
import { orderResultsByRecency, totalsAcrossSeries } from "@/lib/team-season";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ListSkeleton } from "@/components/ui/skeleton";
import { Section } from "@/components/ui/page";

/**
 * Standings and results for every series the team races in.
 *
 * Championship position comes from the series' own standings table, so a
 * penalty deduction the stewards applied shows up here without being
 * recalculated — one source of truth for points.
 */
export function ResultsPanel({ teamId }: { teamId: string }) {
  const season = api.team.season.useQuery(
    { teamId },
    { meta: { silenceError: true } },
  );

  if (season.isLoading) return <ListSkeleton />;
  if (season.error)
    return <p className="text-sm text-brand-red">{season.error.message}</p>;

  const { summaries, results } = season.data!;
  const totals = totalsAcrossSeries(summaries);
  const recent = orderResultsByRecency(
    results.map((result) => ({
      ...result,
      eventDate: new Date(result.eventDate),
    })),
  );

  if (summaries.length === 0 && recent.length === 0) {
    return (
      <Section title="Standings & results">
        <p className="text-brand-black/60">
          Nothing classified yet. Confirmed entries appear here once an event is
          completed and its results are in.
        </p>
      </Section>
    );
  }

  return (
    <Section title="Standings & results">
      <div className="flex flex-wrap gap-6 text-sm">
        <Stat label="Series" value={String(totals.seriesCount)} />
        <Stat label="Starts" value={String(totals.starts)} />
        <Stat label="Wins" value={String(totals.wins)} />
        <Stat label="Podiums" value={String(totals.podiums)} />
        <Stat
          label="Best finish"
          value={totals.bestFinish === null ? "—" : `P${totals.bestFinish}`}
        />
      </div>

      {summaries.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {summaries.map((summary) => (
            <Card key={summary.seriesId}>
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <CardTitle>
                    <Link
                      href={`/series/${summary.seriesSlug}/standings`}
                      className="hover:text-brand-red"
                    >
                      {summary.seriesName}
                    </Link>
                  </CardTitle>
                  <Badge
                    variant={summary.position === 1 ? "verified" : "default"}
                  >
                    {summary.position === null
                      ? "Unclassified"
                      : `P${summary.position} of ${summary.fieldSize}`}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-1 text-xs text-brand-black/70">
                <p>
                  <strong className="text-base text-brand-black">
                    {summary.points}
                  </strong>{" "}
                  points · {summary.starts} start
                  {summary.starts === 1 ? "" : "s"} · {summary.wins} win
                  {summary.wins === 1 ? "" : "s"} · {summary.podiums} podium
                  {summary.podiums === 1 ? "" : "s"}
                </p>
                {summary.pointsDeducted > 0 && (
                  <p className="text-brand-red">
                    −{summary.pointsDeducted} points from {summary.penaltyCount}{" "}
                    penalt
                    {summary.penaltyCount === 1 ? "y" : "ies"}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {recent.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-brand-black/50">
            Every result
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-brand-black/10 text-left text-xs uppercase tracking-wide text-brand-black/60">
                <tr>
                  <th className="py-2 pr-3">Event</th>
                  <th className="py-2 pr-3">Series</th>
                  <th className="py-2 pr-3">Date</th>
                  <th className="py-2 pr-3">Car</th>
                  <th className="py-2">Result</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((result) => (
                  <tr
                    key={result.registrationId}
                    className="border-b border-brand-black/5 last:border-0"
                  >
                    <td className="py-2 pr-3">
                      <Link
                        href={`/events/${result.eventId}`}
                        className="hover:text-brand-red"
                      >
                        {result.eventName}
                      </Link>
                    </td>
                    <td className="py-2 pr-3 text-brand-black/60">
                      {result.seriesName}
                    </td>
                    <td className="py-2 pr-3 text-brand-black/60">
                      {result.eventDate.toLocaleDateString()}
                    </td>
                    <td className="py-2 pr-3 text-brand-black/60">
                      {[
                        result.carNumber && `#${result.carNumber}`,
                        result.carClass,
                      ]
                        .filter(Boolean)
                        .join(" ") || "—"}
                    </td>
                    <td className="py-2">
                      {result.status === null ? (
                        <span className="text-brand-black/50">
                          Not classified
                        </span>
                      ) : (
                        <>
                          <span className="font-medium">
                            {result.finishPosition !== null
                              ? `P${result.finishPosition}`
                              : RESULT_STATUS_LABELS[result.status]}
                          </span>
                          {result.fastestLap && (
                            <span className="ml-2 text-xs text-brand-red">
                              FL
                            </span>
                          )}
                          {result.activePenalties > 0 && (
                            <Link
                              href={`/events/${result.eventId}/penalties`}
                              className="ml-2 text-xs text-brand-red hover:underline"
                            >
                              {result.activePenalties} penalt
                              {result.activePenalties === 1 ? "y" : "ies"}
                            </Link>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-brand-black/50">
        {label}
      </p>
      <p className="text-lg font-bold tabular-nums">{value}</p>
    </div>
  );
}
