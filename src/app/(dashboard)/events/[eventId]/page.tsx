import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { TRPCError } from "@trpc/server";
import { serverApi } from "@/server/trpc/server-caller";
import { EVENT_STATUS_LABELS } from "@/lib/events";
import { SESSION_TYPE_LABELS, groupSessionsByDay, scheduleSpan } from "@/lib/schedule";
import { SESSION_STATUS_LABELS } from "@/lib/timing";
import { eventVenueLabel } from "@/lib/tracks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AnnouncementsPanel } from "@/components/announcements-panel";
import { DocumentsPanel } from "@/components/documents-panel";
import { GeneratedDocuments } from "@/components/generated-documents";
import { MediaPanel } from "@/components/media-panel";
import { PaddockChat } from "@/components/paddock-chat";
import { EntryPanels } from "./entry-panels";

/**
 * Public landing page for a single event — the link that goes out to entrants.
 *
 * Server-rendered with metadata so it previews properly when shared. Anything
 * that depends on who is looking (your entry, your shifts, chat) is a client
 * island below.
 */

async function loadEvent(eventId: string) {
  try {
    return await (await serverApi()).event.byId({ eventId });
  } catch (error) {
    if (
      error instanceof TRPCError &&
      (error.code === "NOT_FOUND" || error.code === "BAD_REQUEST")
    ) {
      return null;
    }
    throw error;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ eventId: string }>;
}): Promise<Metadata> {
  const { eventId } = await params;
  const event = await loadEvent(eventId);
  if (!event) return { title: "Event not found · RaceOps" };

  const descriptor = [
    event.series?.name,
    eventVenueLabel(event),
    event.platform,
    new Date(event.date).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }),
  ]
    .filter(Boolean)
    .join(" · ");
  const description = event.description?.slice(0, 200) ?? descriptor;

  return {
    title: `${event.name} · RaceOps`,
    description,
    openGraph: { title: event.name, description, type: "website" },
  };
}

export default async function EventLandingPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  const api = await serverApi();
  const event = await loadEvent(eventId);
  if (!event) notFound();

  const sessions = await api.session.forEvent({ eventId });
  const days = groupSessionsByDay(sessions);
  const span = scheduleSpan(sessions);
  const isOrganizer = Boolean(event.myRole);

  return (
    <div className="space-y-10">
      {/* Hero */}
      <header className="space-y-4 border-b border-brand-black/10 pb-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            {event.series && (
              <Link
                href={`/series/${event.series.slug}`}
                className="text-xs font-semibold uppercase tracking-widest text-brand-red hover:underline"
              >
                {event.series.name}
              </Link>
            )}
            <h1 className="text-4xl font-bold tracking-tight">{event.name}</h1>
            <p className="text-sm text-brand-black/60">
              {[
                eventVenueLabel(event),
                event.platform,
                span && span.days > 1
                  ? `${new Date(span.start).toLocaleDateString()} – ${new Date(
                      span.end,
                    ).toLocaleDateString()} · ${span.days} days`
                  : new Date(event.date).toLocaleString(),
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={event.status === "PUBLISHED" ? "verified" : "default"}>
              {EVENT_STATUS_LABELS[event.status]}
            </Badge>
            <Link href={`/events/${eventId}/timing`}>
              <Button size="sm" variant="outline">
                Live timing
              </Button>
            </Link>
            <Link href={`/events/${eventId}/incidents`}>
              <Button size="sm" variant="outline">
                Incidents
              </Button>
            </Link>
            <Link href={`/events/${eventId}/penalties`}>
              <Button size="sm" variant="outline">
                Penalties
              </Button>
            </Link>
            {isOrganizer && (
              <Link href={`/events/${eventId}/manage`}>
                <Button size="sm" variant="primary">
                  Manage
                </Button>
              </Link>
            )}
          </div>
        </div>

        {event.description && (
          <p className="max-w-3xl whitespace-pre-wrap text-sm leading-relaxed text-brand-black/80">
            {event.description}
          </p>
        )}

        <div className="flex flex-wrap gap-6 text-sm">
          <Stat label="Confirmed entries" value={String(event.confirmedCount)} />
          {event.entryCapacity !== null && (
            <Stat label="Entry capacity" value={String(event.entryCapacity)} />
          )}
          <Stat
            label="Sessions"
            value={sessions.length === 0 ? "TBC" : String(sessions.length)}
          />
        </div>
      </header>

      {days.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Running order</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {days.map((day) => (
              <Card key={day.dayKey}>
                <CardHeader>
                  <CardTitle>
                    {day.date.toLocaleDateString(undefined, {
                      weekday: "long",
                      month: "short",
                      day: "numeric",
                    })}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {day.sessions.map((session) => (
                    <div
                      key={session.id}
                      className="flex items-baseline justify-between gap-2 text-sm"
                    >
                      <div className="min-w-0">
                        <p className="font-medium">{session.name}</p>
                        <p className="text-xs text-brand-black/60">
                          {[
                            SESSION_TYPE_LABELS[session.type],
                            session.location,
                            session.status !== "SCHEDULED" &&
                              SESSION_STATUS_LABELS[session.status],
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </div>
                      <span className="shrink-0 tabular-nums text-brand-black/70">
                        {new Date(session.startsAt).toLocaleTimeString(
                          undefined,
                          { hour: "2-digit", minute: "2-digit" },
                        )}
                      </span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}

      <EntryList eventId={eventId} />

      <EntryPanels eventId={eventId} />

      <AnnouncementsPanel
        scope={{ eventId }}
        canManage={false}
        title="Event notices"
      />
      <GeneratedDocuments eventId={eventId} />
      <DocumentsPanel
        scope={{ eventId }}
        canManage={false}
        title="Event documents"
      />
      <MediaPanel
        scope={{ eventId }}
        title="Event media"
        description="Post-race coverage and approved imagery."
        canManage={isOrganizer}
        allowOrganizerOnly={isOrganizer}
      />
      <PaddockChat scope={{ eventId }} />
    </div>
  );
}

/** Public entry list with declared crews — who is driving what. */
async function EntryList({ eventId }: { eventId: string }) {
  const entries = await (await serverApi()).lineup.forEvent({ eventId });
  if (entries.length === 0) return null;

  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold">Entry list</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-brand-black/10 text-left text-xs uppercase tracking-wide text-brand-black/60">
            <tr>
              <th className="py-2 pr-3">No.</th>
              <th className="py-2 pr-3">Entrant</th>
              <th className="py-2 pr-3">Class</th>
              <th className="py-2">Drivers</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr
                key={entry.id}
                className="border-b border-brand-black/5 last:border-0"
              >
                <td className="py-2 pr-3 font-semibold tabular-nums">
                  {entry.carNumber ?? "—"}
                </td>
                <td className="py-2 pr-3">
                  {entry.team ? (
                    <Link
                      href={`/teams/${entry.team.slug}`}
                      className="hover:text-brand-red"
                    >
                      {entry.team.name}
                    </Link>
                  ) : (
                    (entry.entrantUser?.profile?.displayName ?? "Entry")
                  )}
                </td>
                <td className="py-2 pr-3 text-brand-black/60">
                  {entry.carClass ?? "—"}
                </td>
                <td className="py-2 text-brand-black/80">
                  {entry.lineup.length === 0
                    ? "—"
                    : entry.lineup
                        .map(
                          (driver) =>
                            driver.user.profile?.displayName ?? "Unnamed",
                        )
                        .join(", ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
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
