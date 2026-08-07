"use client";

import Link from "next/link";
import type { inferRouterOutputs } from "@trpc/server";
import { api } from "@/lib/trpc/client";
import { attentionItems } from "@/lib/attention";
import type { AppRouter } from "@/server/trpc/root";
import { greeting, relativeDay } from "@/lib/dashboard";
import { REGISTRATION_STATUS_LABELS } from "@/lib/events";
import { eventVenueLabel } from "@/lib/tracks";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { MyPasses } from "@/components/my-passes";
import { EmptyState, PageHeader, Section, Stat } from "@/components/ui/page";

/**
 * The signed-in home page.
 *
 * Ordered by what needs a person now: anything running or blocking first, then
 * their next race, then the rest. Someone opening this on a Saturday morning
 * should not have to hunt for the session that is live.
 *
 * A person with no entries and no team sees a genuine first-run page rather
 * than a wall of empty cards — that first screen is where an organization
 * decides whether the platform is worth learning.
 */
export default function HomePage() {
  const home = api.dashboard.home.useQuery(undefined, {
    // Cheap to refresh and the live-session row goes stale fastest.
    refetchInterval: 60_000,
  });

  if (home.isLoading) {
    return <p className="text-brand-black/60">Loading…</p>;
  }
  if (home.error) {
    return <p className="text-brand-red">{home.error.message}</p>;
  }

  const data = home.data!;
  const name = data.profile?.displayName ?? null;
  const isNew =
    data.counts.upcomingEntries === 0 &&
    data.teams.length === 0 &&
    data.series.length === 0 &&
    data.organizations.length === 0;

  return (
    <div className="space-y-8">
      <PageHeader
        title={greeting(name)}
        description={
          isNew
            ? "Let's get you set up."
            : "Everything that needs you, and what's coming."
        }
        actions={
          <Link href="/profile">
            <Avatar src={data.profile?.avatarUrl} name={name} size="md" />
          </Link>
        }
      />

      {isNew ? (
        <FirstRun />
      ) : (
        <>
          {data.actions.length > 0 && (
            <Section
              title="Needs you"
              description="Things that are blocked or happening now."
            >
              <div className="space-y-2">
                {data.actions.map((action) => (
                  <Card
                    key={action.id}
                    className={
                      action.urgency === "now"
                        ? "border-brand-red/40"
                        : undefined
                    }
                  >
                    <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                      <div className="min-w-0">
                        <p className="font-medium">{action.title}</p>
                        <p className="text-sm text-brand-black/60">
                          {action.detail}
                        </p>
                      </div>
                      <Link href={action.href}>
                        <Button
                          size="sm"
                          variant={
                            action.urgency === "now" ? "primary" : "outline"
                          }
                        >
                          {action.actionLabel}
                        </Button>
                      </Link>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </Section>
          )}

          {data.attention.length > 0 && (
            <Section
              title="Waiting on you"
              description="Across the teams you run. Everything above is you as a competitor; this is you as a manager."
            >
              <div className="space-y-2">
                {data.attention.map((team) => (
                  <Card key={team.teamId}>
                    <CardContent className="space-y-2 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-medium">{team.teamName}</p>
                        <Link href={`/teams/${team.teamSlug}/manage`}>
                          <Button size="sm" variant="outline">
                            Open console
                          </Button>
                        </Link>
                      </div>
                      {/* Each chip links into the tab that fixes it, rather
                          than dropping somebody at the top of a long console
                          to find it themselves. */}
                      <div className="flex flex-wrap gap-2">
                        {attentionItems(team).map((item) => (
                          <Link
                            key={item.key}
                            href={item.href}
                            className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                              item.tone === "urgent"
                                ? "border-brand-red/40 bg-brand-red/[0.06] text-brand-red hover:bg-brand-red/10"
                                : "border-brand-black/15 hover:bg-brand-black/[0.04]"
                            }`}
                          >
                            {item.label}
                          </Link>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </Section>
          )}

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Upcoming entries"
              value={data.counts.upcomingEntries}
              href="/events"
            />
            <Stat
              label="Volunteer shifts"
              value={data.counts.shifts}
              href="/events"
            />
            <Stat
              label="Needs you"
              value={data.counts.needsAction}
              tone={data.counts.needsAction > 0 ? "alert" : "default"}
            />
            <Stat
              label="Unread messages"
              value={data.unreadMessages}
              href="/messages"
              tone={data.unreadMessages > 0 ? "alert" : "default"}
            />
          </div>

          <Section
            title="Your races"
            description="Entries you have in, soonest first."
            actions={
              <Link href="/events">
                <Button size="sm" variant="outline">
                  Find a race
                </Button>
              </Link>
            }
          >
            {data.upcoming.length === 0 ? (
              <EmptyState
                title="Nothing entered yet"
                description="Published events are open to enter, and organizers usually confirm within a day or two."
                action={
                  <Link href="/events">
                    <Button size="sm" variant="primary">
                      Browse events
                    </Button>
                  </Link>
                }
              />
            ) : (
              <div className="space-y-2">
                {data.upcoming.map((entry) => (
                  <Card key={entry.id}>
                    <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                      <div className="min-w-0">
                        <Link
                          href={`/events/${entry.event.id}`}
                          className="font-medium hover:text-brand-red"
                        >
                          {entry.event.name}
                        </Link>
                        <p className="text-sm text-brand-black/60">
                          {[
                            entry.event.series?.name,
                            eventVenueLabel(entry.event),
                            relativeDay(new Date(entry.event.date)),
                            entry.team?.name,
                            entry.carNumber ? `#${entry.carNumber}` : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </div>
                      <Badge
                        variant={
                          entry.status === "CONFIRMED" ? "verified" : "default"
                        }
                      >
                        {REGISTRATION_STATUS_LABELS[entry.status]}
                      </Badge>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </Section>

          <MyPasses />

          {data.shifts.length > 0 && (
            <Section
              title="Your shifts"
              description="Volunteer work you have signed up for."
            >
              <div className="space-y-2">
                {data.shifts.map((signup) => (
                  <Card key={signup.id}>
                    <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                      <div>
                        <p className="font-medium">{signup.shift.title}</p>
                        <p className="text-sm text-brand-black/60">
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

          <WhatYouRun data={data} />

          {data.past.length > 0 && (
            <Section title="Recently raced">
              <div className="space-y-1">
                {data.past.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex flex-wrap items-center justify-between gap-2 border-b border-brand-black/5 py-2 text-sm last:border-0"
                  >
                    <Link
                      href={`/events/${entry.event.id}`}
                      className="hover:text-brand-red"
                    >
                      {entry.event.name}
                    </Link>
                    <span className="text-brand-black/50">
                      {relativeDay(new Date(entry.event.date))}
                    </span>
                  </div>
                ))}
              </div>
            </Section>
          )}
        </>
      )}
    </div>
  );
}

type HomeData = inferRouterOutputs<AppRouter>["dashboard"]["home"];

/** Organizations, series and teams this person helps run. */
function WhatYouRun({ data }: { data: HomeData }) {
  const groups = [
    {
      title: "Organizations",
      items: data.organizations.map((org) => ({
        id: org.id,
        name: org.name,
        href: `/organizations/${org.slug}`,
        logo: org.branding?.logoUrl ?? null,
        role: org.myRole,
      })),
    },
    {
      title: "Series you organize",
      items: data.series.map((series) => ({
        id: series.id,
        name: series.name,
        href: `/series/${series.slug}/manage`,
        logo: series.branding?.logoUrl ?? series.logoUrl,
        role: series.myRole,
      })),
    },
    {
      title: "Your teams",
      items: data.teams.map((team) => ({
        id: team.id,
        name: team.name,
        href: `/teams/${team.slug}/manage`,
        logo: team.branding?.logoUrl ?? team.logoUrl,
        role: team.myRole,
      })),
    },
  ].filter((group) => group.items.length > 0);

  if (groups.length === 0) return null;

  return (
    <>
      {groups.map((group) => (
        <Section key={group.title} title={group.title}>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {group.items.map((item) => (
              <Link key={item.id} href={item.href}>
                <Card className="transition-colors hover:border-brand-black/25">
                  <CardContent className="flex items-center gap-3 p-3">
                    <Avatar src={item.logo} name={item.name} size="sm" />
                    <div className="min-w-0">
                      <p className="truncate font-medium">{item.name}</p>
                      <p className="text-xs text-brand-black/60">
                        {item.role.replace(/_/g, " ").toLowerCase()}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </Section>
      ))}
    </>
  );
}

/**
 * The first screen someone sees with nothing set up.
 *
 * Four routes rather than a generic welcome, because the platform serves
 * different people and each wants a different first click. This is the screen
 * where an organization decides whether it is worth learning.
 *
 * The three that need approving say so here rather than at the create button.
 * Sending somebody to a form that refuses them is how a first run becomes a
 * bounce — and racing takes no approval at all, which is the point worth
 * making first.
 */
function FirstRun() {
  const routes = [
    {
      title: "I want to race",
      description:
        "Find an event, enter as yourself or a team, and sign what you need to. No approval needed — go.",
      href: "/events",
      cta: "Browse events",
      primary: true,
    },
    {
      title: "I run a championship",
      description:
        "A calendar, entries, standings and race control. Reviewed first, so entrants can trust a series page is real.",
      href: "/apply",
      cta: "Apply to run a series",
      primary: false,
    },
    {
      title: "I run a team",
      description:
        "Drivers, crew, a garage, entries and sponsors. Reviewed first — it takes a minute and stops the directory filling with ghosts.",
      href: "/apply",
      cta: "Apply to run a team",
      primary: false,
    },
    {
      title: "I want to sponsor",
      description:
        "Back teams and track every deal in one console. Reviewed first, because a sponsor account can pitch every team here.",
      href: "/apply",
      cta: "Apply as a sponsor",
      primary: false,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {routes.map((route) => (
          <Card key={route.title} className="flex flex-col">
            <CardContent className="flex flex-1 flex-col gap-3 p-5">
              <div className="flex-1">
                <p className="font-semibold">{route.title}</p>
                <p className="mt-1 text-sm text-brand-black/60">
                  {route.description}
                </p>
              </div>
              <Link href={route.href}>
                <Button
                  size="sm"
                  variant={route.primary ? "primary" : "outline"}
                >
                  {route.cta}
                </Button>
              </Link>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <p className="font-medium">Finish your profile</p>
            <p className="text-sm text-brand-black/60">
              A picture and your role tags are what let teams and organizers
              find you.
            </p>
          </div>
          <Link href="/profile">
            <Button size="sm" variant="outline">
              Edit profile
            </Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
