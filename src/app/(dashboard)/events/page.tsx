"use client";

import Link from "next/link";
import { api } from "@/lib/trpc/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EVENT_STATUS_LABELS, REGISTRATION_STATUS_LABELS } from "@/lib/events";

export default function EventsPage() {
  const events = api.event.listPublished.useQuery({});
  const myRegistrations = api.event.myRegistrations.useQuery();
  const myShifts = api.event.myVolunteerShifts.useQuery();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Events</h1>
        <p className="mt-1 text-sm text-brand-black/60">
          Enter a race, or sign up to work one.
        </p>
      </div>

      {myRegistrations.data && myRegistrations.data.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">My entries</h2>
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
        </section>
      )}

      {myShifts.data && myShifts.data.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">My volunteer shifts</h2>
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
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Upcoming events</h2>
        {events.isLoading && <p className="text-brand-black/60">Loading…</p>}
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
      </section>
    </div>
  );
}
