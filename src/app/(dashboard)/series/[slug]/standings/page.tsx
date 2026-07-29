"use client";

import { use } from "react";
import Link from "next/link";
import { api } from "@/lib/trpc/client";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

export default function StandingsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  const series = api.series.bySlug.useQuery({ slug });
  const standings = api.series.standings.useQuery(
    { seriesId: series.data?.id ?? "" },
    { enabled: Boolean(series.data?.id) },
  );

  if (series.isLoading) return <p className="text-brand-black/60">Loading…</p>;
  if (series.error)
    return <p className="text-brand-red">{series.error.message}</p>;

  const rows = standings.data?.rows ?? [];

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/series/${slug}`}
          className="text-sm text-brand-red hover:underline"
        >
          ← {series.data!.name}
        </Link>
        <h1 className="mt-1 text-3xl font-bold">Championship standings</h1>
        <p className="mt-1 text-sm text-brand-black/60">
          Points from completed rounds, less any deductions from penalties that
          still stand.
        </p>
      </div>

      {standings.isLoading && <p className="text-brand-black/60">Loading…</p>}
      {!standings.isLoading && rows.length === 0 && (
        <p className="text-brand-black/60">
          No completed rounds yet — standings appear once an event is marked
          completed and results are recorded.
        </p>
      )}

      {rows.length > 0 && (
        <Card>
          <CardContent className="p-0">
            {/* Wide table scrolls inside its own container on small screens. */}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="border-b border-brand-black/10 text-left text-xs uppercase text-brand-black/60">
                  <tr>
                    <th className="p-3">#</th>
                    <th className="p-3">Competitor</th>
                    <th className="p-3 text-right">Starts</th>
                    <th className="p-3 text-right">Wins</th>
                    <th className="p-3 text-right">Podiums</th>
                    <th className="p-3 text-right">Best</th>
                    <th className="p-3 text-right">Deducted</th>
                    <th className="p-3 text-right">Points</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => (
                    <tr
                      key={row.competitorKey}
                      className="border-b border-brand-black/5 last:border-0"
                    >
                      <td className="p-3 font-semibold">{index + 1}</td>
                      <td className="p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          {row.teamId ? (
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
