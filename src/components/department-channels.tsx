"use client";

import { useState } from "react";
import { ChannelKind, OrgRole, SeriesRole, TeamRole } from "@prisma/client";
import { api } from "@/lib/trpc/client";
import { describeAudience, describeAudienceProblem } from "@/lib/channels";
import { TEAM_ROLE_LABELS } from "@/lib/teams";
import { SERIES_ROLE_LABELS } from "@/lib/permissions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PaddockChat } from "@/components/paddock-chat";

/**
 * Department channels for one scope.
 *
 * The list only shows channels the viewer can actually enter. That is not
 * politeness — a room list showing four channels you cannot open tells
 * everyone what departments exist and roughly who is in them, which is
 * information a private channel is supposed to be keeping.
 */

export type ChannelScope = {
  teamId?: string;
  eventId?: string;
  seriesId?: string;
  organizationId?: string;
};

const ORG_ROLE_LABELS: Record<OrgRole, string> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  STAFF: "Staff",
};

export function DepartmentChannels({
  scope,
  title = "Department channels",
  description = "Rooms narrower than this one. Membership follows the roles people hold — leave the role, leave the room.",
}: {
  scope: ChannelScope;
  title?: string;
  description?: string;
}) {
  const utils = api.useUtils();
  const channels = api.channel.list.useQuery(
    { scope },
    {
      meta: { silenceError: true },
      retry: false,
    },
  );
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const refresh = () => utils.channel.list.invalidate({ scope });
  const create = api.channel.create.useMutation({
    meta: { silenceError: true },
    onSuccess: () => {
      setCreating(false);
      refresh();
    },
  });

  if (channels.error) {
    return (
      <section className="space-y-2">
        <h2 className="text-xl font-semibold">{title}</h2>
        <p className="text-sm text-brand-black/60">{channels.error.message}</p>
      </section>
    );
  }

  const rooms = channels.data?.channels ?? [];
  const canManage = channels.data?.canManage ?? false;
  const suggestions = channels.data?.suggestions ?? [];
  const open = rooms.find((room) => room.id === openId) ?? null;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-xl font-semibold">{title}</h2>
          <p className="max-w-2xl text-sm text-brand-black/60">{description}</p>
        </div>
        {canManage && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setCreating((value) => !value)}
          >
            {creating ? "Cancel" : "New channel"}
          </Button>
        )}
      </div>

      {creating && (
        <ChannelForm
          scope={scope}
          pending={create.isPending}
          error={create.error?.message ?? null}
          onSubmit={(values) => create.mutate({ scope, ...values })}
        />
      )}

      {canManage && suggestions.length > 0 && !creating && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-brand-black/60">Quick add:</span>
          {suggestions.map((template) => (
            <button
              key={template.slug}
              type="button"
              className="rounded-full border border-brand-black/20 px-3 py-1 text-xs hover:bg-brand-black/5 disabled:opacity-50"
              disabled={create.isPending}
              title={template.description}
              onClick={() =>
                create.mutate({
                  scope,
                  name: template.name,
                  description: template.description,
                  kind: ChannelKind.DEPARTMENT,
                  teamRoles: template.teamRoles,
                })
              }
            >
              {template.name}
            </button>
          ))}
        </div>
      )}

      {channels.isLoading && (
        <p className="text-sm text-brand-black/60">Loading channels…</p>
      )}

      {!channels.isLoading && rooms.length === 0 && !creating && (
        <p className="rounded-lg border border-dashed border-brand-black/20 p-6 text-center text-sm text-brand-black/55">
          {canManage
            ? "No channels here yet. The engineers and the crew usually want their own before anyone else does."
            : "No channels you can see here. Department channels only appear to the roles they are for."}
        </p>
      )}

      {rooms.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {rooms.map((room) => (
            <button
              key={room.id}
              type="button"
              className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                openId === room.id
                  ? "border-brand-red bg-brand-red text-on-red"
                  : "border-brand-black/20 hover:bg-brand-black/5"
              }`}
              onClick={() =>
                setOpenId((current) => (current === room.id ? null : room.id))
              }
            >
              {room.name}
              {room._count.messages > 0 && (
                <span className="ml-2 text-xs opacity-70">
                  {room._count.messages}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {open && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant={open.kind === ChannelKind.OPEN ? "default" : "outline"}
            >
              {describeAudience(
                {
                  kind: open.kind,
                  teamRoles: open.teamRoles,
                  seriesRoles: open.seriesRoles,
                  orgRoles: open.orgRoles,
                  staffRoleId: open.staffRoleId,
                  includesEntrantTeams: open.includesEntrantTeams,
                },
                {
                  team: TEAM_ROLE_LABELS,
                  series: SERIES_ROLE_LABELS,
                  org: ORG_ROLE_LABELS,
                },
                open.staffRole?.name,
              )}
            </Badge>
            {open.archived && <Badge variant="outline">Archived</Badge>}
            {canManage && (
              <ArchiveButton
                channelId={open.id}
                archived={open.archived}
                onChanged={refresh}
              />
            )}
          </div>
          {open.description && (
            <p className="text-sm text-brand-black/60">{open.description}</p>
          )}
          <PaddockChat
            scope={{ channelId: open.id }}
            heading={false}
            readOnly={open.archived}
            placeholder={`Message ${open.name}`}
          />
        </div>
      )}
    </section>
  );
}

function ArchiveButton({
  channelId,
  archived,
  onChanged,
}: {
  channelId: string;
  archived: boolean;
  onChanged: () => void;
}) {
  const archive = api.channel.archive.useMutation({ onSuccess: onChanged });
  return (
    <button
      type="button"
      className="text-xs text-brand-black/50 hover:text-brand-black hover:underline"
      disabled={archive.isPending}
      onClick={() => archive.mutate({ channelId, archived: !archived })}
    >
      {archived ? "Reopen" : "Archive"}
    </button>
  );
}

interface ChannelValues {
  name: string;
  description: string | null;
  kind: ChannelKind;
  teamRoles: TeamRole[];
  seriesRoles: SeriesRole[];
  orgRoles: OrgRole[];
  includesEntrantTeams: boolean;
}

/**
 * Creating a channel.
 *
 * Which role lists to offer follows the scope: a team has team roles, a series
 * has series roles, an event has both — because an event channel can be the
 * officials' room *or* the paddock-wide engineers' room, and those are the two
 * genuinely different things somebody comes here to make.
 */
function ChannelForm({
  scope,
  pending,
  error,
  onSubmit,
}: {
  scope: ChannelScope;
  pending: boolean;
  error: string | null;
  onSubmit: (values: ChannelValues) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState<ChannelKind>(ChannelKind.DEPARTMENT);
  const [teamRoles, setTeamRoles] = useState<TeamRole[]>([]);
  const [seriesRoles, setSeriesRoles] = useState<SeriesRole[]>([]);
  const [orgRoles, setOrgRoles] = useState<OrgRole[]>([]);
  const [includesEntrantTeams, setIncludesEntrantTeams] = useState(false);

  const showTeamRoles = Boolean(scope.teamId ?? scope.eventId);
  const showSeriesRoles = Boolean(scope.seriesId ?? scope.eventId);
  const showOrgRoles = Boolean(scope.organizationId);

  const problem = describeAudienceProblem({
    kind,
    teamRoles,
    seriesRoles,
    orgRoles,
    staffRoleId: null,
  });

  function toggle<T>(list: T[], value: T, set: (next: T[]) => void) {
    set(
      list.includes(value) ? list.filter((x) => x !== value) : [...list, value],
    );
  }

  return (
    <Card className="max-w-3xl">
      <CardContent className="space-y-4 p-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="block text-sm font-medium sm:col-span-2">
            Channel name
            <input
              className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Engineering"
            />
          </label>
          <label className="block text-sm font-medium">
            Who it is for
            <select
              className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
              value={kind}
              onChange={(event) => {
                const next = event.target.value as ChannelKind;
                setKind(next);
                if (next === ChannelKind.OPEN) {
                  setTeamRoles([]);
                  setSeriesRoles([]);
                  setOrgRoles([]);
                }
              }}
            >
              <option value={ChannelKind.DEPARTMENT}>Specific roles</option>
              <option value={ChannelKind.OPEN}>Everyone here</option>
            </select>
          </label>
        </div>

        <label className="block text-sm font-medium">
          What it is for <span className="text-brand-black/50">(optional)</span>
          <input
            className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Data, setup direction and what the car is actually doing."
          />
        </label>

        {kind === ChannelKind.DEPARTMENT && (
          <div className="space-y-3">
            {showTeamRoles && (
              <RolePicker
                label="Team roles"
                options={Object.values(TeamRole)}
                labels={TEAM_ROLE_LABELS}
                selected={teamRoles}
                onToggle={(role) => toggle(teamRoles, role, setTeamRoles)}
              />
            )}
            {showSeriesRoles && (
              <RolePicker
                label="Series roles"
                options={Object.values(SeriesRole)}
                labels={SERIES_ROLE_LABELS}
                selected={seriesRoles}
                onToggle={(role) => toggle(seriesRoles, role, setSeriesRoles)}
              />
            )}
            {showOrgRoles && (
              <RolePicker
                label="Organization roles"
                options={Object.values(OrgRole)}
                labels={ORG_ROLE_LABELS}
                selected={orgRoles}
                onToggle={(role) => toggle(orgRoles, role, setOrgRoles)}
              />
            )}

            {scope.eventId && teamRoles.length > 0 && (
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={includesEntrantTeams}
                  onChange={(event) =>
                    setIncludesEntrantTeams(event.target.checked)
                  }
                />
                <span>
                  Include the same roles from every team entered
                  <span className="block text-xs text-brand-black/55">
                    This is what makes it a paddock-wide room — every engineer
                    at the meeting, not just the series&rsquo; own staff.
                  </span>
                </span>
              </label>
            )}
          </div>
        )}

        {problem && <p className="text-sm text-amber-600">{problem}</p>}
        {error && <p className="text-sm text-brand-red">{error}</p>}

        <Button
          variant="primary"
          disabled={pending || name.trim().length < 1 || problem !== null}
          onClick={() =>
            onSubmit({
              name: name.trim(),
              description: description.trim() || null,
              kind,
              teamRoles,
              seriesRoles,
              orgRoles,
              includesEntrantTeams,
            })
          }
        >
          {pending ? "Creating…" : "Create channel"}
        </Button>
      </CardContent>
    </Card>
  );
}

function RolePicker<T extends string>({
  label,
  options,
  labels,
  selected,
  onToggle,
}: {
  label: string;
  options: readonly T[];
  labels: Record<T, string>;
  selected: readonly T[];
  onToggle: (value: T) => void;
}) {
  return (
    <div>
      <p className="text-sm font-medium">{label}</p>
      <div className="mt-1 flex flex-wrap gap-2">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            className={`rounded-full border px-3 py-1 text-xs transition-colors ${
              selected.includes(option)
                ? "border-brand-red bg-brand-red text-on-red"
                : "border-brand-black/20 hover:bg-brand-black/5"
            }`}
            onClick={() => onToggle(option)}
          >
            {labels[option]}
          </button>
        ))}
      </div>
    </div>
  );
}
