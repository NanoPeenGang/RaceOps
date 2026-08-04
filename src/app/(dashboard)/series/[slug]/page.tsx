import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { TRPCError } from "@trpc/server";
import { EventStatus } from "@prisma/client";
import { serverApi } from "@/server/trpc/server-caller";
import { EVENT_STATUS_LABELS } from "@/lib/events";
import {
  SERIES_RULE_DESCRIPTIONS,
  SERIES_RULE_LABELS,
  groupSeriesRules,
} from "@/lib/series-rules";
import { isStale, verifiedLabel } from "@/lib/track-rules";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AnnouncementsPanel } from "@/components/announcements-panel";
import { DocumentsPanel } from "@/components/documents-panel";
import { MediaPanel } from "@/components/media-panel";
import { BrandHeader, BrandTheme } from "@/components/brand-theme";
import { brandingForSeries } from "@/server/services/branding";
import { db } from "@/server/db/client";
import { StandingsPreview } from "./standings-preview";

/**
 * Public landing page for a championship — the link an organizer shares.
 *
 * Server-rendered so it carries real metadata for social cards and search,
 * with the interactive panels mounted as client islands underneath.
 */

async function loadSeries(slug: string) {
  try {
    return await (await serverApi()).series.bySlug({ slug });
  } catch (error) {
    if (error instanceof TRPCError && error.code === "NOT_FOUND") return null;
    throw error;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const series = await loadSeries(slug);
  if (!series) return { title: "Series not found · RaceOps" };

  const descriptor = [
    series.season,
    series.discipline === "SIM" ? "Sim racing" : "Real-world racing",
    series.platform,
    `${series.events.length} round${series.events.length === 1 ? "" : "s"}`,
  ]
    .filter(Boolean)
    .join(" · ");
  const description = series.description?.slice(0, 200) ?? descriptor;

  return {
    title: `${series.name} · RaceOps`,
    description,
    openGraph: {
      title: series.name,
      description,
      type: "website",
    },
  };
}

export default async function SeriesLandingPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const series = await loadSeries(slug);
  if (!series) notFound();

  const canManage = Boolean(series.myRole);
  const canPublish =
    series.myRole === "OWNER" ||
    series.myRole === "ADMIN" ||
    series.myRole === "RACE_CONTROL";

  const published = series.events.filter(
    (event) => event.status !== EventStatus.DRAFT,
  );
  const now = Date.now();
  const nextRound = published.find(
    (event) => new Date(event.date).getTime() >= now,
  );
  const completed = published.filter(
    (event) => event.status === EventStatus.COMPLETED,
  );

  const ruleGroups = groupSeriesRules(series.rules);
  const branding = await brandingForSeries(db, series.id);

  return (
    <BrandTheme branding={branding} className="space-y-10">
      <BrandHeader
        branding={branding}
        name={series.name}
        eyebrow={`${series.discipline === "SIM" ? "Sim racing" : "Real-world racing"}${series.season ? ` · ${series.season}` : ""}`}
        meta={[
          series.platform,
          `${published.length} round${published.length === 1 ? "" : "s"}`,
          `${completed.length} completed`,
        ]
          .filter(Boolean)
          .join(" · ")}
        actions={
          <>
            <Link href={`/series/${slug}/standings`}>
              <Button variant="outline">Standings</Button>
            </Link>
            {canManage && (
              <Link href={`/series/${slug}/manage`}>
                <Button variant="primary">Manage series</Button>
              </Link>
            )}
          </>
        }
      />

      <div className="space-y-4">
        {series.isReference && (
          <Card className="max-w-3xl border-brand-black/20 bg-brand-black/[0.03]">
            <CardContent className="space-y-1 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">Reference</Badge>
                <p className="text-sm font-medium">
                  Shipped with RaceOps, not run on it.
                </p>
              </div>
              <p className="text-sm leading-relaxed text-brand-black/70">
                Nobody organizes this copy — the calendar and regulations below
                are a summary of what the series publishes, kept so you can plan
                a season before you enter one. Entries, timing and results
                happen wherever the series actually runs them.
                {series.sourceUrl ? " Check the source before you commit." : ""}
              </p>
              {series.sourceUrl && (
                <a
                  href={series.sourceUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-block text-sm text-brand-red hover:underline"
                >
                  {series.sourceUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")} ↗
                </a>
              )}
            </CardContent>
          </Card>
        )}

        {series.description && (
          <p className="max-w-3xl whitespace-pre-wrap text-sm leading-relaxed text-brand-black/80">
            {series.description}
          </p>
        )}

        {nextRound && (
          <Card className="max-w-xl border-brand-red/30">
            <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-brand-black/50">
                  Next round
                </p>
                <p className="font-medium">{nextRound.name}</p>
                <p className="text-xs text-brand-black/60">
                  {[
                    nextRound.venue,
                    new Date(nextRound.date).toLocaleDateString(undefined, {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                    }),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <Link href={`/events/${nextRound.id}`}>
                <Button size="sm" variant="primary">
                  Event page
                </Button>
              </Link>
            </CardContent>
          </Card>
        )}
      </div>

      <StandingsPreview seriesId={series.id} slug={slug} />

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Calendar</h2>
        {published.length === 0 ? (
          <p className="text-brand-black/60">
            No rounds published yet.
            {canManage ? " Add and publish events from the series console." : ""}
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {published.map((event) => (
              <Card key={event.id}>
                <CardHeader>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <CardTitle>{event.name}</CardTitle>
                    <Badge
                      variant={
                        event.status === EventStatus.COMPLETED
                          ? "default"
                          : "verified"
                      }
                    >
                      {EVENT_STATUS_LABELS[event.status]}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  <p className="text-xs text-brand-black/60">
                    {[
                      event.venue,
                      event.platform,
                      new Date(event.date).toLocaleDateString(),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Link href={`/events/${event.id}`}>
                      <Button size="sm" variant="outline">
                        Details
                      </Button>
                    </Link>
                    <Link href={`/events/${event.id}/timing`}>
                      <Button size="sm" variant="outline">
                        Timing
                      </Button>
                    </Link>
                    <Link href={`/events/${event.id}/penalties`}>
                      <Button size="sm" variant="outline">
                        Penalties
                      </Button>
                    </Link>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      {ruleGroups.length > 0 && (
        <section className="space-y-4">
          <div>
            <h2 className="text-xl font-semibold">Sporting regulations</h2>
            <p className="text-sm text-brand-black/60">
              What the series requires of a car and a crew. Facility rules are
              separate, and live on each circuit&rsquo;s track page.
            </p>
          </div>

          {ruleGroups.map((group) => (
            <div key={group.kind} className="space-y-2">
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-brand-black/50">
                  {SERIES_RULE_LABELS[group.kind]}
                </h3>
                <p className="text-xs text-brand-black/50">
                  {SERIES_RULE_DESCRIPTIONS[group.kind]}
                </p>
              </div>
              {group.rules.map((rule) => (
                <Card key={rule.id}>
                  <CardContent className="space-y-2 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <p className="font-medium">{rule.title}</p>
                      {isStale(rule.verifiedOn) && (
                        <Badge variant="outline">May be out of date</Badge>
                      )}
                    </div>
                    {rule.detail && (
                      <p className="whitespace-pre-wrap text-sm leading-relaxed text-brand-black/75">
                        {rule.detail}
                      </p>
                    )}
                    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-brand-black/50">
                      {rule.citation && <span>{rule.citation}</span>}
                      {rule.sourceUrl && (
                        <a
                          href={rule.sourceUrl}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="text-brand-red hover:underline"
                        >
                          Source ↗
                        </a>
                      )}
                      <span>{verifiedLabel(rule.verifiedOn)}</span>
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          ))}
        </section>
      )}

      <AnnouncementsPanel
        scope={{ seriesId: series.id }}
        canManage={canPublish}
        title="Announcements"
      />
      <DocumentsPanel
        scope={{ seriesId: series.id }}
        canManage={canPublish}
        title="Regulations & documents"
      />
      <MediaPanel
        scope={{ seriesId: series.id }}
        title="Media"
        description="Season coverage and approved imagery."
        canManage={canPublish}
        allowOrganizerOnly={canPublish}
      />

      {/* A reference series has none by design; an empty heading reads as a
          missing list rather than an intentionally absent one. */}
      {series.organizers.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Organizers</h2>
          <div className="flex flex-wrap gap-2">
            {series.organizers.map((organizer) => (
              <Badge key={organizer.id}>
                {organizer.user.profile?.displayName ?? "Unnamed"} ·{" "}
                {organizer.role.replace(/_/g, " ").toLowerCase()}
              </Badge>
            ))}
          </div>
        </section>
      )}
    </BrandTheme>
  );
}
