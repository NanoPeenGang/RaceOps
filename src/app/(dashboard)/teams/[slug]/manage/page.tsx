"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { TeamRole } from "@prisma/client";
import { api } from "@/lib/trpc/client";
import { TEAM_ROLE_LABELS, isTeamManager } from "@/lib/teams";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { MediaPanel } from "@/components/media-panel";
import { PaddockChat } from "@/components/paddock-chat";
import { RosterPanel } from "./roster-panel";
import { SchedulePanel } from "./schedule-panel";
import { ResultsPanel } from "./results-panel";
import { SponsorsPanel } from "./sponsors-panel";
import { GaragePanel } from "./garage-panel";
import { InventoryPanel } from "./inventory-panel";
import { FilesPanel } from "./files-panel";
import { ServicePanel } from "./service-panel";
import { InvoicesPanel } from "./invoices-panel";
import { SeatTimePanel } from "./seat-time-panel";
import { HiringPanel } from "./hiring-panel";
import { PayrollPanel } from "./payroll-panel";
import { DepartmentChannels } from "@/components/department-channels";
import { BrandingEditor } from "@/components/branding-editor";
import { DangerZone } from "@/components/danger-zone";
import { type TabDefinition } from "@/components/ui/tabs";
import { Console } from "@/components/ui/console";
import { TEAM_CONSOLE_PAGES } from "@/lib/nav";
import { attentionItems, tabBadge, type TeamAttention } from "@/lib/attention";
import { PageSkeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/ui/page";

/**
 * Team console — one page to run a race team: who is on the books, what races
 * are coming, how the season is going, the commercial side, and the team's own
 * chat.
 */
export default function TeamManagePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  const utils = api.useUtils();
  // The console is keyed by id, but the URL is a slug — resolve it first.
  const team = api.team.bySlug.useQuery(
    { slug },
    { meta: { silenceError: true } },
  );
  const teamId = team.data?.id;

  const dashboard = api.team.dashboard.useQuery(
    { teamId: teamId ?? "" },
    { enabled: Boolean(teamId), retry: false },
  );

  if (team.isLoading || (teamId && dashboard.isLoading)) {
    return <PageSkeleton />;
  }
  if (team.error) return <p className="text-brand-red">{team.error.message}</p>;
  if (dashboard.error) {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-bold">{team.data?.name}</h1>
        <p className="text-brand-red">{dashboard.error.message}</p>
        <Link href={`/teams/${slug}`}>
          <Button variant="outline">Back to the team page</Button>
        </Link>
      </div>
    );
  }

  const data = dashboard.data!;
  const refresh = () => {
    utils.team.dashboard.invalidate({ teamId: data.id });
    utils.team.bySlug.invalidate({ slug });
  };

  const manager = isTeamManager(data.myRole);
  const attention = data.attention;

  /*
   * Seven tabs rather than one long page. The console grew to a dozen panels
   * and finding the pit stop planner meant scrolling past payroll — and
   * because `Tabs` renders only the active panel, this also stops a page load
   * firing every panel's queries at once.
   *
   * Grouped by the job somebody sat down to do, not by which model the data
   * lives in: seat time is a roster question even though it is built from
   * stints, and sponsors are money even though they are nothing like payroll.
   */
  const tabs: TabDefinition[] = [
    {
      id: "roster",
      label: "Roster",
      content: (
        <div className="space-y-10">
          <RosterPanel team={data} onChanged={refresh} />
          <SeatTimePanel teamId={data.id} />
        </div>
      ),
    },
    {
      id: "hiring",
      label: "Hiring",
      visible: manager,
      badge: tabBadge(attention, "hiring"),
      content: <HiringPanel teamId={data.id} />,
    },
    {
      id: "money",
      label: "Money",
      visible: manager,
      badge: tabBadge(attention, "money"),
      content: (
        <div className="space-y-10">
          <PayrollPanel teamId={data.id} />
          <SponsorsPanel team={data} />
        </div>
      ),
    },
    {
      id: "garage",
      label: "Garage",
      badge: tabBadge(attention, "garage"),
      content: (
        <div className="space-y-10">
          <GaragePanel team={data} />
          <ServicePanel teamId={data.id} />
          <InventoryPanel teamId={data.id} teamSlug={slug} />
          {/* After the work and the parts, because that is the order somebody
              raises an invoice in: what was done, what went into it, what it
              comes to. */}
          <InvoicesPanel teamId={data.id} teamSlug={slug} />
          <FilesPanel teamId={data.id} />
        </div>
      ),
    },
    {
      id: "racing",
      label: "Racing",
      content: (
        <div className="space-y-10">
          <SchedulePanel team={data} onChanged={refresh} />
          <ResultsPanel teamId={data.id} />
        </div>
      ),
    },
    {
      id: "comms",
      label: "Comms",
      content: (
        <div className="space-y-10">
          <PaddockChat
            scope={{ teamId: data.id }}
            title="Team chat"
            placeholder={`Message ${data.name}`}
          />
          <DepartmentChannels
            scope={{ teamId: data.id }}
            description="Rooms narrower than the whole roster — the engineers, the crew, the drivers. Membership follows the role somebody holds on this team, so leaving the role leaves the room."
          />
          <MediaPanel
            scope={{ teamId: data.id }}
            title="Team media"
            description="Liveries, team photos and race coverage."
            canManage={manager}
          />
        </div>
      ),
    },
    {
      id: "settings",
      label: "Settings",
      visible: manager,
      content: (
        <div className="space-y-10">
          <TeamSettings team={data} onSaved={refresh} defaultOpen />
          <BrandingEditor scope={{ teamId: data.id }} name={data.name} />
          {/* Owners only, and last on the tab: nobody scrolls past a roster
              and a branding editor by accident. */}
          {data.myRole === TeamRole.OWNER && (
            <TeamDangerZone teamId={data.id} teamName={data.name} />
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <header className="space-y-3">
        <Link
          href={`/teams/${slug}`}
          className="text-sm text-brand-red hover:underline"
        >
          ← {data.name}
        </Link>
        <PageHeader
          title="Team console"
          description={[
            data.homeBase,
            `${data.roster.filter((m) => m.endDate === null).length} on the books`,
          ]
            .filter(Boolean)
            .join(" · ")}
          actions={
            <>
              <Badge variant="verified">{TEAM_ROLE_LABELS[data.myRole]}</Badge>
            </>
          }
        />
      </header>

      {/* Above the tabs on purpose: the whole point is that it is seen without
          opening the tab it points at. */}
      {attention && <AttentionStrip attention={attention} />}

      <Console
        tabs={tabs}
        pagesLabel="Team pages"
        pages={TEAM_CONSOLE_PAGES.map((page) => ({
          href: `/teams/${slug}/${page.segment}`,
          label: page.label,
        }))}
      />
    </div>
  );
}

/** What is waiting on a manager, linking straight into the tab that fixes it. */
function AttentionStrip({ attention }: { attention: TeamAttention }) {
  const items = attentionItems(attention);
  if (items.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
            item.tone === "urgent"
              ? "border-brand-red/40 bg-brand-red/[0.06] text-brand-red hover:bg-brand-red/10"
              : "border-brand-black/15 hover:bg-brand-black/[0.04]"
          }`}
        >
          {item.label}
        </Link>
      ))}
    </div>
  );
}

/** Public-facing team details, shown on the landing page. */
function TeamSettings({
  team,
  onSaved,
  defaultOpen = false,
}: {
  team: {
    id: string;
    name: string;
    description: string | null;
    websiteUrl: string | null;
    homeBase: string | null;
  };
  onSaved: () => void;
  /** On a Settings tab the form is the point of the page, so it starts open. */
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [name, setName] = useState(team.name);
  const [description, setDescription] = useState(team.description ?? "");
  const [websiteUrl, setWebsiteUrl] = useState(team.websiteUrl ?? "");
  const [homeBase, setHomeBase] = useState(team.homeBase ?? "");

  const update = api.team.update.useMutation({
    meta: { silenceError: true, successMessage: "Team saved." },
    onSuccess: () => {
      setOpen(false);
      onSaved();
    },
  });

  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Edit team details
      </Button>
    );
  }

  return (
    <Card className="max-w-2xl">
      <CardContent className="space-y-4 p-5">
        <label className="block text-sm font-medium">
          Team name
          <input
            className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            minLength={2}
            maxLength={120}
          />
          <span className="mt-1 block text-xs font-normal text-brand-black/50">
            Renaming changes the name on the door, not the address — your
            existing links keep working.
          </span>
        </label>
        <label className="block text-sm font-medium">
          Home base <span className="text-brand-black/50">(optional)</span>
          <input
            className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
            value={homeBase}
            onChange={(e) => setHomeBase(e.target.value)}
            placeholder="Silverstone, UK"
          />
        </label>
        <label className="block text-sm font-medium">
          Website <span className="text-brand-black/50">(optional)</span>
          <input
            className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
            value={websiteUrl}
            onChange={(e) => setWebsiteUrl(e.target.value)}
            placeholder="https://…"
          />
        </label>
        <label className="block text-sm font-medium">
          About the team
          <textarea
            rows={5}
            className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        {update.error && (
          <p className="text-sm text-brand-red">{update.error.message}</p>
        )}
        <div className="flex gap-2">
          <Button
            variant="primary"
            disabled={update.isPending}
            onClick={() =>
              update.mutate({
                teamId: team.id,
                name: name.trim(),
                description: description.trim() || null,
                websiteUrl: websiteUrl.trim() || null,
                homeBase: homeBase.trim() || null,
              })
            }
          >
            {update.isPending ? "Saving…" : "Save details"}
          </Button>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Ending a team.
 *
 * Owner-only, and the counts are fetched before the button unlocks rather than
 * described in prose. A team is the busiest thing on this platform — roster,
 * garage, hiring, money — and "are you sure?" is not a question anybody can
 * answer without knowing what is behind it.
 */
function TeamDangerZone({
  teamId,
  teamName,
}: {
  teamId: string;
  teamName: string;
}) {
  const router = useRouter();
  const impact = api.team.deletionImpact.useQuery(
    { teamId },
    { meta: { silenceError: true } },
  );
  const remove = api.team.delete.useMutation({
    meta: { silenceError: true, successMessage: "Team deleted." },
    onSuccess: () => router.push("/teams"),
  });

  const data = impact.data;

  return (
    <DangerZone
      title={`Delete ${teamName}`}
      description="Everything below goes with it, and none of it can be brought back."
      isLoadingImpact={impact.isLoading}
      impact={data ? { ...EMPTY_IMPACT, name: data.name } : undefined}
      lines={
        data && [
          { label: "People on the roster", count: data.roster },
          { label: "Cars", count: data.cars },
          { label: "Stock lines", count: data.inventory },
          { label: "Telemetry and setup files", count: data.files },
          { label: "Invoices", count: data.invoices },
          { label: "Pay runs", count: data.payRuns },
          { label: "Sponsorship deals", count: data.sponsorships },
          { label: "Job and seat postings", count: data.postings },
          {
            label: "Event entries",
            count: data.registrations,
            warn: "Entries sit in other organizers' events — deleting the team removes its cars from entry lists it does not own.",
          },
          {
            label: "Race results",
            count: data.results,
            warn: "Results go with the entries they hang off, so championships this team raced in will change.",
          },
        ]
      }
      onDelete={(confirmName) => remove.mutate({ teamId, confirmName })}
      isDeleting={remove.isPending}
      error={impact.error?.message ?? remove.error?.message ?? null}
    />
  );
}

/**
 * The legacy fixed shape, satisfied so the retype guard has a name to compare
 * against. Every count a team actually has is passed through `lines`.
 */
const EMPTY_IMPACT = {
  name: "",
  registrations: 0,
  results: 0,
  penalties: 0,
  volunteerShifts: 0,
  media: 0,
};
