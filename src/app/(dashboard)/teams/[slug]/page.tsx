import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { TRPCError } from "@trpc/server";
import type { inferRouterOutputs } from "@trpc/server";
import { serverApi } from "@/server/trpc/server-caller";
import type { AppRouter } from "@/server/trpc/root";
import { TEAM_ROLE_LABELS, splitRoster } from "@/lib/teams";
import { orderResultsByRecency, totalsAcrossSeries } from "@/lib/team-season";
import { RESULT_STATUS_LABELS } from "@/lib/standings";
import { roleTagsOf } from "@/lib/roles";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BrandHeader, BrandTheme } from "@/components/brand-theme";
import { brandingForTeam } from "@/server/services/branding";
import { db } from "@/server/db/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MediaPanel } from "@/components/media-panel";
import { Section } from "@/components/ui/page";

/**
 * Public team landing page: who they are, who drives, and what they have done.
 * The competition record is public because it is the team's reputation; entry
 * notes and commercial terms live in the console instead.
 */

async function loadTeam(slug: string) {
  try {
    return await (await serverApi()).team.bySlug({ slug });
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
  const team = await loadTeam(slug);
  if (!team) return { title: "Team not found · RaceOps" };

  const description =
    team.description?.slice(0, 200) ??
    `${team.roster.length} member${team.roster.length === 1 ? "" : "s"}${
      team.homeBase ? ` · ${team.homeBase}` : ""
    }`;

  return {
    title: `${team.name} · RaceOps`,
    description,
    openGraph: { title: team.name, description, type: "website" },
  };
}

export default async function TeamLandingPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const api = await serverApi();
  const team = await loadTeam(slug);
  if (!team) notFound();

  const [season, myTeams] = await Promise.all([
    api.team.season({ teamId: team.id }),
    // Anonymous visitors have no teams; a signed-out read must not 401 the page.
    api.team.myTeams().catch(() => []),
  ]);

  const membership = myTeams.find((entry) => entry.id === team.id);
  const roster = splitRoster(
    team.roster.map((member) => ({
      ...member,
      startDate: new Date(member.startDate),
      endDate: member.endDate ? new Date(member.endDate) : null,
    })),
  );
  const totals = totalsAcrossSeries(season.summaries);
  const recent = orderResultsByRecency(
    season.results.map((result) => ({
      ...result,
      eventDate: new Date(result.eventDate),
    })),
  ).slice(0, 8);

  const branding = await brandingForTeam(db, team.id);

  return (
    <BrandTheme branding={branding} className="space-y-10">
      <BrandHeader
        branding={branding}
        name={team.name}
        eyebrow="Race team"
        meta={[
          team.homeBase,
          `${roster.active.length} member${roster.active.length === 1 ? "" : "s"}`,
          `${roster.drivers.length} driver${roster.drivers.length === 1 ? "" : "s"}`,
        ]
          .filter(Boolean)
          .join(" · ")}
        actions={
          <>
            {team.websiteUrl && (
              <a
                href={team.websiteUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Button variant="outline">Website</Button>
              </a>
            )}
            {membership && (
              <Link href={`/teams/${slug}/manage`}>
                <Button variant="primary">Team console</Button>
              </Link>
            )}
          </>
        }
      />

      <div className="space-y-4">
        {team.description && (
          <p className="max-w-3xl whitespace-pre-wrap text-sm leading-relaxed text-brand-black/80">
            {team.description}
          </p>
        )}

        <div className="flex flex-wrap gap-6 text-sm">
          <Stat label="Series" value={String(totals.seriesCount)} />
          <Stat label="Starts" value={String(totals.starts)} />
          <Stat label="Wins" value={String(totals.wins)} />
          <Stat label="Podiums" value={String(totals.podiums)} />
          <Stat
            label="Best finish"
            value={totals.bestFinish === null ? "—" : `P${totals.bestFinish}`}
          />
        </div>
      </div>

      {season.summaries.length > 0 && (
        <Section title="Championships">
          <div className="grid gap-3 sm:grid-cols-2">
            {season.summaries.map((summary) => (
              <Card key={summary.seriesId}>
                <CardHeader>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <CardTitle>
                      <Link
                        href={`/series/${summary.seriesSlug}`}
                        className="hover:text-brand-red"
                      >
                        {summary.seriesName}
                      </Link>
                    </CardTitle>
                    <Badge
                      variant={summary.position === 1 ? "verified" : "default"}
                    >
                      {summary.position === null
                        ? "Unclassified"
                        : `P${summary.position} of ${summary.fieldSize}`}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-1 text-xs text-brand-black/70">
                  <p>
                    <strong className="text-base text-brand-black">
                      {summary.points}
                    </strong>{" "}
                    points · {summary.starts} start
                    {summary.starts === 1 ? "" : "s"} · {summary.wins} win
                    {summary.wins === 1 ? "" : "s"} · {summary.podiums} podium
                    {summary.podiums === 1 ? "" : "s"}
                  </p>
                  {summary.pointsDeducted > 0 && (
                    <p className="text-brand-red">
                      {summary.pointsDeducted} points deducted from{" "}
                      {summary.penaltyCount} penalt
                      {summary.penaltyCount === 1 ? "y" : "ies"}
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </Section>
      )}

      <Section title="Line-up">
        {roster.drivers.length > 0 && (
          <RosterGroup title="Drivers" members={roster.drivers} />
        )}
        {roster.staff.length > 0 && (
          <RosterGroup title="Staff" members={roster.staff} />
        )}
        {roster.active.length === 0 && (
          <p className="text-brand-black/60">No current members listed.</p>
        )}
      </Section>

      {recent.length > 0 && (
        <Section title="Recent results">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-brand-black/10 text-left text-xs uppercase tracking-wide text-brand-black/60">
                <tr>
                  <th className="py-2 pr-3">Event</th>
                  <th className="py-2 pr-3">Series</th>
                  <th className="py-2 pr-3">Date</th>
                  <th className="py-2 pr-3">Car</th>
                  <th className="py-2">Result</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((result) => (
                  <tr
                    key={result.registrationId}
                    className="border-b border-brand-black/5 last:border-0"
                  >
                    <td className="py-2 pr-3">
                      <Link
                        href={`/events/${result.eventId}`}
                        className="hover:text-brand-red"
                      >
                        {result.eventName}
                      </Link>
                    </td>
                    <td className="py-2 pr-3 text-brand-black/60">
                      {result.seriesName}
                    </td>
                    <td className="py-2 pr-3 text-brand-black/60">
                      {result.eventDate.toLocaleDateString()}
                    </td>
                    <td className="py-2 pr-3 text-brand-black/60">
                      {[
                        result.carNumber && `#${result.carNumber}`,
                        result.carClass,
                      ]
                        .filter(Boolean)
                        .join(" ") || "—"}
                    </td>
                    <td className="py-2">
                      {result.status === null ? (
                        <span className="text-brand-black/50">
                          Not classified
                        </span>
                      ) : (
                        <span className="font-medium">
                          {result.finishPosition !== null
                            ? `P${result.finishPosition}`
                            : RESULT_STATUS_LABELS[result.status]}
                          {result.fastestLap ? " · FL" : ""}
                          {result.activePenalties > 0
                            ? ` · ${result.activePenalties} penalty`
                            : ""}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      <MediaPanel
        scope={{ teamId: team.id }}
        title="Media"
        description="Team imagery and race coverage."
        canManage={
          membership?.myRole === "OWNER" || membership?.myRole === "MANAGER"
        }
      />
    </BrandTheme>
  );
}

type TeamBySlug = inferRouterOutputs<AppRouter>["team"]["bySlug"];
/** Roster entries as the router returns them, with dates already revived. */
type RosterEntry = Omit<
  TeamBySlug["roster"][number],
  "startDate" | "endDate"
> & {
  startDate: Date;
  endDate: Date | null;
};

function RosterGroup({
  title,
  members,
}: {
  title: string;
  members: RosterEntry[];
}) {
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-brand-black/50">
        {title}
      </h3>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {members.map((member) => {
          const tags = member.user.profile
            ? roleTagsOf(member.user.profile)
            : [];
          return (
            <Card key={member.id}>
              <CardContent className="space-y-1.5 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">
                    {member.user.profile?.displayName ?? "Unnamed"}
                  </p>
                  <Badge>{TEAM_ROLE_LABELS[member.role]}</Badge>
                </div>
                {member.user.profile?.location && (
                  <p className="text-xs text-brand-black/60">
                    {member.user.profile.location}
                  </p>
                )}
                {tags.length > 0 && (
                  <p className="text-xs text-brand-black/70">
                    {tags
                      .slice(0, 4)
                      .map((tag) => tag.label)
                      .join(" · ")}
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
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
