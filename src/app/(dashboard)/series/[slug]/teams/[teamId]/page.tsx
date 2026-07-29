"use client";

import { use } from "react";
import Link from "next/link";
import { api } from "@/lib/trpc/client";
import {
  APPEAL_STATUS_LABELS,
  PENALTY_STATUS_LABELS,
  describePenalty,
} from "@/lib/penalties";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MediaPanel } from "@/components/media-panel";

/**
 * A competitor's public record within a series: championship position and the
 * full penalty history, including any appeal and its outcome.
 */
export default function TeamSeriesProfilePage({
  params,
}: {
  params: Promise<{ slug: string; teamId: string }>;
}) {
  const { slug, teamId } = use(params);
  const series = api.series.bySlug.useQuery({ slug });
  const seriesId = series.data?.id ?? "";

  const standings = api.series.standings.useQuery(
    { seriesId },
    { enabled: Boolean(seriesId) },
  );
  const penalties = api.penalty.forCompetitorInSeries.useQuery(
    { seriesId, teamId },
    { enabled: Boolean(seriesId) },
  );

  if (series.isLoading) return <p className="text-brand-black/60">Loading…</p>;
  if (series.error)
    return <p className="text-brand-red">{series.error.message}</p>;

  const row = standings.data?.rows.find((r) => r.teamId === teamId);
  const position = standings.data?.rows.findIndex((r) => r.teamId === teamId);
  const teamName =
    row?.competitorLabel ??
    penalties.data?.[0]?.registration.team?.name ??
    "Team";

  return (
    <div className="space-y-8">
      <div>
        <Link
          href={`/series/${slug}`}
          className="text-sm text-brand-red hover:underline"
        >
          ← {series.data!.name}
        </Link>
        <h1 className="mt-1 text-3xl font-bold">{teamName}</h1>
        <p className="mt-1 text-sm text-brand-black/60">
          Series record and disciplinary history
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <Stat
          label="Position"
          value={position !== undefined && position >= 0 ? position + 1 : "—"}
        />
        <Stat label="Points" value={row?.points ?? 0} />
        <Stat label="Wins" value={row?.wins ?? 0} />
        <Stat label="Penalties" value={penalties.data?.length ?? 0} />
      </div>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Penalty record</h2>
        {penalties.isLoading && <p className="text-brand-black/60">Loading…</p>}
        {penalties.data?.length === 0 && (
          <p className="text-brand-black/60">
            No penalties on record in this series.
          </p>
        )}
        <div className="space-y-3">
          {penalties.data?.map((penalty) => (
            <Card key={penalty.id}>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle>{describePenalty(penalty)}</CardTitle>
                  <Badge
                    variant={
                      penalty.status === "OVERTURNED" ? "default" : "verified"
                    }
                  >
                    {PENALTY_STATUS_LABELS[penalty.status]}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-sm font-medium">{penalty.summary}</p>
                {penalty.details && (
                  <p className="whitespace-pre-wrap text-sm text-brand-black/80">
                    {penalty.details}
                  </p>
                )}
                <p className="text-xs text-brand-black/60">
                  {[
                    penalty.event.name,
                    penalty.regulation && `Art. ${penalty.regulation}`,
                    penalty.lapNumber !== null && `Lap ${penalty.lapNumber}`,
                    `Issued by ${penalty.issuedBy.profile?.displayName ?? "race control"}`,
                    new Date(penalty.createdAt).toLocaleDateString(),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>

                {penalty.appeal && (
                  <div className="rounded-lg border border-brand-black/10 bg-brand-black/[0.02] p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-semibold">Appeal</p>
                      <Badge>
                        {APPEAL_STATUS_LABELS[penalty.appeal.status]}
                      </Badge>
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
                  </div>
                )}

                {penalty.media.length > 0 && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {penalty.media.map((item) => (
                      <a
                        key={item.id}
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-medium text-brand-red hover:underline"
                      >
                        {item.title || item.kind}
                      </a>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <MediaPanel
        scope={{ teamId }}
        title="Team media"
        description="Post-race coverage and team uploads."
        canManage={false}
      />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <Card>
      <CardContent className="p-5">
        <p className="text-xs text-brand-black/60">{label}</p>
        <p className="mt-1 text-2xl font-bold">{value}</p>
      </CardContent>
    </Card>
  );
}
