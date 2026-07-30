import { unstable_rethrow } from "next/navigation";
import { serverApi } from "@/server/trpc/server-caller";

export interface PlatformPulse {
  seriesCount: number;
  upcomingEvents: number;
  teamCount: number;
  openOpportunities: number;
  live: { id: string; eventId: string; label: string }[];
}

/**
 * Live activity for the landing page.
 *
 * Deliberately fail-soft: the landing page is the one page that must never
 * break, so a database that is unreachable or not yet migrated returns null
 * and the page renders its static content instead of a 500.
 */
export async function platformPulse(): Promise<PlatformPulse | null> {
  try {
    const api = await serverApi();
    const [series, events, teams, opportunities, live] = await Promise.all([
      api.series.list({ limit: 50 }),
      api.event.listPublished({ limit: 50 }),
      api.team.list({ limit: 50 }),
      api.opportunity.list({ limit: 50 }),
      api.session.liveNow(),
    ]);

    const now = Date.now();
    return {
      seriesCount: series.items.length,
      upcomingEvents: events.items.filter(
        (event) => new Date(event.date).getTime() >= now,
      ).length,
      teamCount: teams.teams.length,
      openOpportunities: opportunities.items.length,
      live: live.map((session) => ({
        id: session.id,
        eventId: session.event.id,
        label: [session.event.series?.name, session.event.name, session.name]
          .filter(Boolean)
          .join(" · "),
      })),
    };
  } catch (error) {
    // Next signals "bail out to dynamic rendering" by throwing. Swallowing
    // that would prerender this page with no pulse and never recover, so it
    // has to pass straight through — only real failures degrade to null.
    unstable_rethrow(error);
    console.error("Landing page pulse unavailable (non-fatal):", error);
    return null;
  }
}
