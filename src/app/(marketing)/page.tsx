import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import {
  AUDIENCE_PATHS,
  CAPABILITY_GROUPS,
  DISCIPLINE_POINTS,
} from "@/lib/marketing";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { platformPulse } from "./pulse";

export const metadata: Metadata = {
  // Absolute: the root template appends "| RaceOps", which would double the
  // brand name on the one page whose title already leads with it.
  title: { absolute: "RaceOps — The Operating Platform for Motorsport" },
  description:
    "Run championships, race weekends and teams. Find race seats, crew jobs, volunteer shifts and sponsorship. One platform for all of motorsport, sim and real world.",
};

export default async function LandingPage() {
  // Signed-in people get their own dashboard. The marketing page is for
  // people deciding whether to sign up; sending a member there every time
  // makes them hunt for the thing they came to do.
  const { userId } = await auth();
  if (userId) redirect("/home");

  const pulse = await platformPulse();

  return (
    <main>
      {/* ---------------------------------------------------------------- */}
      {/* Hero                                                             */}
      {/* ---------------------------------------------------------------- */}
      {/* Pinned dark in both themes. This band is a brand statement rather
          than app chrome — everything inside it is written against a literal
          dark ground (text-white/70, border-white/25), and letting it invert
          would produce white-on-pale rather than a light hero. */}
      <section className="relative overflow-hidden bg-[#0a0a0a] text-white">
        {/*
          Checkered-flag nod from the brand mark. Masked so it fades out toward
          the headline instead of ending on a hard vertical seam.
        */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 w-2/3 opacity-[0.07]"
          style={{
            backgroundImage:
              "repeating-conic-gradient(#fff 0% 25%, transparent 0% 50%)",
            backgroundSize: "28px 28px",
            maskImage: "linear-gradient(to right, transparent, #000 60%, #000)",
            WebkitMaskImage:
              "linear-gradient(to right, transparent, #000 60%, #000)",
          }}
        />
        <div className="relative mx-auto max-w-6xl px-4 py-20 sm:py-28">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-red">
            Sim racing · Real-world racing · The whole industry
          </p>
          <h1 className="mt-5 max-w-4xl text-4xl font-bold leading-[1.1] tracking-tight sm:text-6xl">
            The operating platform for{" "}
            <span className="text-brand-red">motorsport</span>
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-white/70">
            Run a championship. Run a race weekend. Run a team. Find a seat, a
            crew job, a marshal post or a sponsor. RaceOps is one place for
            every side of the sport — and it works the same whether your grid is
            on a sim or on a circuit.
          </p>

          <div className="mt-10 flex flex-wrap gap-3">
            <Link href="/sign-up">
              <Button variant="primary" size="lg">
                Get started free
              </Button>
            </Link>
            <Link href="/series">
              <Button
                size="lg"
                className="border border-white/25 bg-transparent text-white hover:bg-white/10"
              >
                Run a series
              </Button>
            </Link>
            <Link href="/opportunities">
              <Button
                size="lg"
                className="border border-white/25 bg-transparent text-white hover:bg-white/10"
              >
                Find a seat or job
              </Button>
            </Link>
          </div>

          {pulse && <PulseStrip pulse={pulse} />}
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* What do you want to do?                                          */}
      {/* ---------------------------------------------------------------- */}
      <section className="mx-auto max-w-6xl px-4 py-20">
        <div className="max-w-2xl">
          <h2 className="text-3xl font-bold tracking-tight">
            What do you need to get done?
          </h2>
          <p className="mt-3 text-brand-black/70">
            Motorsport is not one job. Pick yours — every path below is a
            working part of the platform, not a waitlist.
          </p>
        </div>

        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {AUDIENCE_PATHS.map((path) => (
            <Link key={path.action} href={path.href} className="group">
              <Card className="h-full transition-colors group-hover:border-brand-red/50">
                <CardContent className="flex h-full flex-col gap-2 p-5">
                  {/*
                    Reserved for two lines: some audience labels wrap, and
                    without this the card titles stop aligning across the row.
                  */}
                  <p className="min-h-[2.1rem] text-[0.7rem] font-semibold uppercase leading-tight tracking-wider text-brand-red">
                    {path.audience}
                  </p>
                  <h3 className="text-lg font-semibold leading-snug">
                    {path.action}
                  </h3>
                  <p className="flex-1 text-sm leading-relaxed text-brand-black/70">
                    {path.body}
                  </p>
                  <span className="mt-1 text-sm font-medium text-brand-red">
                    {path.cta} →
                  </span>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Sim and real, as peers                                           */}
      {/* ---------------------------------------------------------------- */}
      <section className="border-y border-brand-black/10 bg-white/60">
        <div className="mx-auto max-w-6xl px-4 py-20">
          <div className="max-w-3xl">
            <h2 className="text-3xl font-bold tracking-tight">
              Sim and real world, as equals
            </h2>
            <p className="mt-3 text-brand-black/70">
              Most tools pick a side, then treat the other as a novelty. The
              regulations, stewarding, timing and commercial problems are the
              same problems. RaceOps solves them once.
            </p>
          </div>
          <div className="mt-10 grid gap-8 md:grid-cols-3">
            {DISCIPLINE_POINTS.map((point) => (
              <div key={point.title} className="space-y-2">
                <div className="h-1 w-10 rounded-full bg-brand-red" />
                <h3 className="text-lg font-semibold">{point.title}</h3>
                <p className="text-sm leading-relaxed text-brand-black/70">
                  {point.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Capabilities                                                     */}
      {/* ---------------------------------------------------------------- */}
      <section className="mx-auto max-w-6xl space-y-16 px-4 py-20">
        <div className="max-w-2xl">
          <h2 className="text-3xl font-bold tracking-tight">
            Everything the sport actually runs on
          </h2>
          <p className="mt-3 text-brand-black/70">
            Not a networking feed with a calendar attached — the operational
            tooling a series, a race weekend and a team need to function.
          </p>
        </div>

        {CAPABILITY_GROUPS.map((group, index) => (
          <div
            key={group.title}
            className="grid gap-8 border-t border-brand-black/10 pt-10 lg:grid-cols-[1fr_1.4fr]"
          >
            <div className="space-y-4">
              <p className="text-sm font-semibold tabular-nums text-brand-red">
                {String(index + 1).padStart(2, "0")}
              </p>
              <h3 className="text-2xl font-bold tracking-tight">
                {group.title}
              </h3>
              <p className="text-sm leading-relaxed text-brand-black/70">
                {group.lede}
              </p>
              <Link href={group.href}>
                <Button variant="primary">{group.cta}</Button>
              </Link>
            </div>
            <ul className="space-y-3">
              {group.bullets.map((bullet) => (
                <li key={bullet} className="flex gap-3 text-sm">
                  <span
                    aria-hidden
                    className="mt-[0.45rem] h-1.5 w-1.5 shrink-0 rounded-full bg-brand-red"
                  />
                  <span className="leading-relaxed text-brand-black/80">
                    {bullet}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Closing CTA                                                      */}
      {/* ---------------------------------------------------------------- */}
      <section className="bg-[#0a0a0a] text-white">
        <div className="mx-auto max-w-6xl px-4 py-20 text-center">
          <h2 className="mx-auto max-w-3xl text-3xl font-bold tracking-tight sm:text-4xl">
            Bring your paddock onto one platform
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-white/70">
            Free to build a profile, create a team or start a series. Nothing
            here waits on a sales call.
          </p>
          <div className="mt-9 flex flex-wrap justify-center gap-3">
            <Link href="/sign-up">
              <Button variant="primary" size="lg">
                Create your account
              </Button>
            </Link>
            <Link href="/search">
              <Button
                size="lg"
                className="border border-white/25 bg-transparent text-white hover:bg-white/10"
              >
                Look around first
              </Button>
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}

/**
 * Live platform activity. Real counts beat invented ones, and a link straight
 * into a running session is the most persuasive thing on the page.
 */
function PulseStrip({
  pulse,
}: {
  pulse: NonNullable<Awaited<ReturnType<typeof platformPulse>>>;
}) {
  return (
    <div className="mt-14 border-t border-white/15 pt-8">
      {pulse.live.length > 0 && (
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-brand-red">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-brand-red" />
            Live now
          </span>
          {pulse.live.slice(0, 3).map((session) => (
            <Link
              key={session.id}
              href={`/events/${session.eventId}/timing`}
              className="rounded-full border border-white/20 px-3 py-1 text-xs text-white/85 transition-colors hover:border-brand-red hover:text-white"
            >
              {session.label}
            </Link>
          ))}
        </div>
      )}

      <dl className="grid grid-cols-2 gap-6 sm:grid-cols-4">
        <PulseStat label="Series" value={pulse.seriesCount} />
        <PulseStat label="Upcoming events" value={pulse.upcomingEvents} />
        <PulseStat label="Teams" value={pulse.teamCount} />
        <PulseStat label="Open opportunities" value={pulse.openOpportunities} />
      </dl>
    </div>
  );
}

function PulseStat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wider text-white/50">
        {label}
      </dt>
      <dd className="mt-1 text-2xl font-bold tabular-nums">{value}</dd>
    </div>
  );
}
