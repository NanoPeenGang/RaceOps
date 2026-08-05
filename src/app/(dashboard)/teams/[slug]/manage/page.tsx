"use client";

import { use, useState } from "react";
import Link from "next/link";
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
import { SeatTimePanel } from "./seat-time-panel";
import { DepartmentChannels } from "@/components/department-channels";
import { BrandingEditor } from "@/components/branding-editor";

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
  const team = api.team.bySlug.useQuery({ slug });
  const teamId = team.data?.id;

  const dashboard = api.team.dashboard.useQuery(
    { teamId: teamId ?? "" },
    { enabled: Boolean(teamId), retry: false },
  );

  if (team.isLoading || (teamId && dashboard.isLoading)) {
    return <p className="text-brand-black/60">Loading…</p>;
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

  return (
    <div className="space-y-10">
      <header className="space-y-3">
        <Link
          href={`/teams/${slug}`}
          className="text-sm text-brand-red hover:underline"
        >
          ← {data.name}
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold">Team console</h1>
            <p className="mt-1 text-sm text-brand-black/60">
              {[
                data.homeBase,
                `${data.roster.filter((m) => m.endDate === null).length} on the books`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          <Badge variant="verified">{TEAM_ROLE_LABELS[data.myRole]}</Badge>
        </div>
      </header>

      {isTeamManager(data.myRole) && <TeamSettings team={data} onSaved={refresh} />}

      {isTeamManager(data.myRole) && (
        <BrandingEditor scope={{ teamId: data.id }} name={data.name} />
      )}

      <RosterPanel team={data} onChanged={refresh} />
      <GaragePanel team={data} />
      <ServicePanel teamId={data.id} />
      <InventoryPanel teamId={data.id} />
      <FilesPanel teamId={data.id} />
      <SchedulePanel team={data} onChanged={refresh} />
      <SeatTimePanel teamId={data.id} />
      <ResultsPanel teamId={data.id} />
      <SponsorsPanel team={data} />

      <MediaPanel
        scope={{ teamId: data.id }}
        title="Team media"
        description="Liveries, team photos and race coverage."
        canManage={isTeamManager(data.myRole)}
      />

      <PaddockChat
        scope={{ teamId: data.id }}
        title="Team chat"
        placeholder={`Message ${data.name}`}
      />

      <DepartmentChannels
        scope={{ teamId: data.id }}
        description="Rooms narrower than the whole roster — the engineers, the crew, the drivers. Membership follows the role somebody holds on this team, so leaving the role leaves the room."
      />
    </div>
  );
}

/** Public-facing team details, shown on the landing page. */
function TeamSettings({
  team,
  onSaved,
}: {
  team: { id: string; description: string | null; websiteUrl: string | null; homeBase: string | null };
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState(team.description ?? "");
  const [websiteUrl, setWebsiteUrl] = useState(team.websiteUrl ?? "");
  const [homeBase, setHomeBase] = useState(team.homeBase ?? "");

  const update = api.team.update.useMutation({
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
