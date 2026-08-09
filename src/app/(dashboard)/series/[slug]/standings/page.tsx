"use client";

import { use, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/trpc/client";
import type { StandingsBasis } from "@/lib/standings";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page";
import { Card, CardContent } from "@/components/ui/card";
import { ListSkeleton, PageSkeleton } from "@/components/ui/skeleton";

const BASIS_LABELS: Record<StandingsBasis, string> = {
  entrant: "Entrants",
  driver: "Drivers",
  team: "Teams",
};

/**
 * Championship standings.
 *
 * A series publishes several tables at once — overall and per class, each in
 * entrant, drivers' and teams' form — so the page is a picker over the set
 * rather than one fixed table.
 */
export default function StandingsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  const series = api.series.bySlug.useQuery(
    { slug },
    { meta: { silenceError: true } },
  );
  const standings = api.series.standings.useQuery(
    { seriesId: series.data?.id ?? "" },
    { enabled: Boolean(series.data?.id) },
  );

  const [basis, setBasis] = useState<StandingsBasis>("entrant");
  const [classId, setClassId] = useState<string | null>(null);

  if (series.isLoading) return <PageSkeleton />;
  if (series.error)
    return <p className="text-brand-red">{series.error.message}</p>;

  const data = standings.data;
  const classes = data?.classes ?? [];
  const table = data?.tables.find(
    (candidate) =>
      candidate.basis === basis && candidate.seriesClassId === classId,
  );
  const rows = table?.rows ?? [];
  const config = data?.config;

  // Only offer a basis that actually has somebody in it: a series of solo
  // entrants has no teams' championship to show.
  const availableBases = (
    ["entrant", "driver", "team"] as StandingsBasis[]
  ).filter(
    (candidate) =>
      data?.tables.some(
        (t) =>
          t.basis === candidate &&
          t.seriesClassId === classId &&
          t.rows.length > 0,
      ) ?? false,
  );

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[
          { label: series.data!.name, href: `/series/${slug}` },
          { label: "Standings" },
        ]}
        title="Championship standings"
        description={
          <>
            Points from completed rounds, less any deductions from penalties
            that still stand.
            {config?.countBestRounds
              ? ` Best ${config.countBestRounds} rounds count${
                  data ? ` of ${data.roundsScored} scored so far` : ""
                }.`
              : ""}
            {config?.minStartsForTitle
              ? ` ${config.minStartsForTitle} starts are needed for title eligibility.`
              : ""}
          </>
        }
      />

      {classes.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-black/50">
            Class
          </p>
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
            <Button
              size="sm"
              variant={classId === null ? "primary" : "outline"}
              className="shrink-0"
              onClick={() => setClassId(null)}
            >
              Overall
            </Button>
            {classes.map((seriesClass) => (
              <Button
                key={seriesClass.id}
                size="sm"
                variant={classId === seriesClass.id ? "primary" : "outline"}
                className="shrink-0"
                onClick={() => setClassId(seriesClass.id)}
              >
                {seriesClass.code ?? seriesClass.name}
              </Button>
            ))}
          </div>
        </div>
      )}

      {availableBases.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {availableBases.map((candidate) => (
            <Button
              key={candidate}
              size="sm"
              variant={basis === candidate ? "primary" : "outline"}
              onClick={() => setBasis(candidate)}
            >
              {BASIS_LABELS[candidate]}
            </Button>
          ))}
        </div>
      )}

      {standings.isLoading && <ListSkeleton />}
      {!standings.isLoading && rows.length === 0 && (
        <p className="text-brand-black/60">
          {classes.length > 0 && classId !== null
            ? "Nothing classified in this class yet."
            : "No completed rounds yet — standings appear once an event is marked completed and results are recorded."}
        </p>
      )}

      {rows.length > 0 && (
        <Card>
          <CardContent className="p-0">
            {/* Wide table scrolls inside its own container on small screens. */}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="border-b border-brand-black/10 text-left text-xs uppercase text-brand-black/60">
                  <tr>
                    <th className="p-3">#</th>
                    <th className="p-3">
                      {basis === "team"
                        ? "Team"
                        : basis === "driver"
                          ? "Driver"
                          : "Competitor"}
                    </th>
                    <th className="p-3 text-right">Starts</th>
                    <th className="p-3 text-right">Wins</th>
                    <th className="p-3 text-right">Podiums</th>
                    <th className="p-3 text-right">Best</th>
                    {config?.countBestRounds ? (
                      <th className="p-3 text-right">Dropped</th>
                    ) : null}
                    <th className="p-3 text-right">Deducted</th>
                    <th className="p-3 text-right">Points</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => (
                    <tr
                      key={row.competitorKey}
                      className={`border-b border-brand-black/5 last:border-0 ${
                        row.titleEligible ? "" : "opacity-60"
                      }`}
                    >
                      <td className="p-3 font-semibold">
                        {row.titleEligible ? index + 1 : "—"}
                      </td>
                      <td className="p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          {basis !== "driver" && row.teamId ? (
                            <Link
                              href={`/series/${slug}/teams/${row.teamId}`}
                              className="font-medium hover:text-brand-red"
                            >
                              {row.competitorLabel}
                            </Link>
                          ) : (
                            <span className="font-medium">
                              {row.competitorLabel}
                            </span>
                          )}
                          {!row.titleEligible && (
                            <Badge>Not title eligible</Badge>
                          )}
                          {row.penaltyCount > 0 && (
                            <Badge>
                              {row.penaltyCount} penalt
                              {row.penaltyCount === 1 ? "y" : "ies"}
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="p-3 text-right">{row.starts}</td>
                      <td className="p-3 text-right">{row.wins}</td>
                      <td className="p-3 text-right">{row.podiums}</td>
                      <td className="p-3 text-right">
                        {row.bestFinish ?? "—"}
                      </td>
                      {config?.countBestRounds ? (
                        <td className="p-3 text-right text-brand-black/60">
                          {row.droppedRounds > 0 ? row.droppedRounds : "—"}
                        </td>
                      ) : null}
                      <td className="p-3 text-right">
                        {row.pointsDeducted > 0 ? (
                          <span className="text-brand-red">
                            −{row.pointsDeducted}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="p-3 text-right font-bold">{row.points}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
