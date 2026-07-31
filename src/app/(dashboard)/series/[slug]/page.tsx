import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { TRPCError } from "@trpc/server";
import { EventStatus } from "@prisma/client";
import { serverApi } from "@/server/trpc/server-caller";
import { EVENT_STATUS_LABELS } from "@/lib/events";
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
    </BrandTheme>
  );
}
