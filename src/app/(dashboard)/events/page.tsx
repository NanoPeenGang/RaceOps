"use client";

import Link from "next/link";
import { api } from "@/lib/trpc/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EVENT_STATUS_LABELS, REGISTRATION_STATUS_LABELS } from "@/lib/events";
import { ListSkeleton } from "@/components/ui/skeleton";
import { PageHeader, Section } from "@/components/ui/page";

export default function EventsPage() {
  const events = api.event.listPublished.useQuery({});
  const myRegistrations = api.event.myRegistrations.useQuery();
  const myShifts = api.event.myVolunteerShifts.useQuery();

  return (
    <div className="space-y-8">
      <PageHeader
        title="Events"
        description="Enter a race, or sign up to work one."
      />

      <LiveNow />

      {myRegistrations.data && myRegistrations.data.length > 0 && (
        <Section title="My entries">
          <div className="space-y-2">
            {myRegistrations.data.map((registration) => (
              <Card key={registration.id}>
                <CardContent className="flex flex-wrap items-center justify-between gap-2 p-4">
                  <div>
                    <Link
                      href={`/events/${registration.event.id}`}
                      className="font-medium hover:text-brand-red"
                    >
                      {registration.event.name}
                    </Link>
                    <p className="text-xs text-brand-black/60">
                      {registration.team
                        ? `${registration.team.name} · `
                        : "Individual · "}
                      {new Date(registration.event.date).toLocaleDateString()}
                    </p>
                  </div>
                  <Badge
                    variant={
                      registration.status === "CONFIRMED"
                        ? "verified"
                        : "default"
                    }
                  >
                    {REGISTRATION_STATUS_LABELS[registration.status]}
                  </Badge>
                </CardContent>
              </Card>
            ))}
          </div>
        </Section>
      )}

      {myShifts.data && myShifts.data.length > 0 && (
        <Section title="My volunteer shifts">
          <div className="space-y-2">
            {myShifts.data.map((signup) => (
              <Card key={signup.id}>
                <CardContent className="flex flex-wrap items-center justify-between gap-2 p-4">
                  <div>
                    <p className="font-medium">{signup.shift.title}</p>
                    <p className="text-xs text-brand-black/60">
                      {signup.shift.event.name} ·{" "}
                      {new Date(signup.shift.startsAt).toLocaleString()}
                    </p>
                  </div>
                  <Badge
                    variant={
                      signup.status === "WAITLISTED" ? "default" : "verified"
                    }
                  >
                    {signup.status.replace("_", " ").toLowerCase()}
                  </Badge>
                </CardContent>
              </Card>
            ))}
          </div>
        </Section>
      )}

      <Section title="Upcoming events">
        {events.isLoading && <ListSkeleton />}
        {events.data?.items.length === 0 && (
          <p className="text-brand-black/60">
            No published events yet. Organizers can create one under{" "}
            <Link href="/series" className="text-brand-red hover:underline">
              Series
            </Link>
            .
          </p>
        )}
        <div className="grid gap-4 md:grid-cols-2">
          {events.data?.items.map((event) => (
            <Card key={event.id}>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle>{event.name}</CardTitle>
                  <Badge>{EVENT_STATUS_LABELS[event.status]}</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-xs text-brand-black/60">
                  {[
                    event.series?.name,
                    event.venue,
                    new Date(event.date).toLocaleDateString(),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                <p className="text-xs text-brand-black/60">
                  {event._count.registrations} entr
                  {event._count.registrations === 1 ? "y" : "ies"}
                  {event.entryCapacity ? ` · ${event.entryCapacity} slots` : ""}
                </p>
                <Link href={`/events/${event.id}`}>
                  <Button size="sm" variant="outline">
                    View event
                  </Button>
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      </Section>
    </div>
  );
}

/** Sessions running right now, anywhere on the platform. */
function LiveNow() {
  const live = api.session.liveNow.useQuery(undefined, {
    refetchInterval: 30000,
  });
  if (!live.data || live.data.length === 0) return null;

  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 text-xl font-semibold">
        <span className="inline-block h-2 w-2 rounded-full bg-brand-red" />
        Live now
      </h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {live.data.map((session) => (
          <Card key={session.id} className="border-brand-red/40">
            <CardContent className="flex flex-wrap items-center justify-between gap-2 p-4">
              <div>
                <p className="font-medium">{session.name}</p>
                <p className="text-xs text-brand-black/60">
                  {[session.event.series?.name, session.event.name]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <Link href={`/events/${session.event.id}/timing`}>
                <Button size="sm" variant="primary">
                  Live timing
                </Button>
              </Link>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
