"use client";

import { useState } from "react";
import { Permission, SeriesRole } from "@prisma/client";
import { api } from "@/lib/trpc/client";
import {
  PERMISSION_DESCRIPTIONS,
  PERMISSION_GROUPS,
  PERMISSION_LABELS,
  SERIES_ROLE_LABELS,
} from "@/lib/permissions";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState, Section } from "@/components/ui/page";

/**
 * Who runs this series, and what each of them can do.
 *
 * Two layers, deliberately visible as two. The built-in roles cover what most
 * championships want and need no thought. Custom roles are for the jobs a club
 * actually has — "Chief Scrutineer", "Assistant Clerk" — and exist so nobody
 * has to make their chief scrutineer an administrator to let them work the
 * technical bay.
 */
export function SeriesStaffPanel({
  seriesId,
  organizationId,
  organizers,
  onChanged,
}: {
  seriesId: string;
  organizationId: string | null;
  organizers: {
    id: string;
    role: SeriesRole;
    user: { id: string; profile: { displayName: string } | null };
  }[];
  onChanged: () => void;
}) {
  const utils = api.useUtils();
  const roles = api.organization.rolesForSeries.useQuery(
    { seriesId },
    { retry: false },
  );
  const [creating, setCreating] = useState(false);

  const refresh = () => {
    utils.organization.rolesForSeries.invalidate({ seriesId });
    onChanged();
  };
  const assign = api.organization.assignRole.useMutation({ onSuccess: refresh });
  const unassign = api.organization.unassignRole.useMutation({
    onSuccess: refresh,
  });

  return (
    <div className="space-y-8">
      <Section
        title="Organizers"
        description="The built-in roles. These cover what most championships need."
      >
        <div className="space-y-2">
          {organizers.map((organizer) => (
            <Card key={organizer.id}>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar
                    name={organizer.user.profile?.displayName}
                    size="sm"
                  />
                  <p className="truncate font-medium">
                    {organizer.user.profile?.displayName ?? "Unnamed"}
                  </p>
                </div>
                <Badge
                  variant={
                    organizer.role === SeriesRole.OWNER ? "verified" : "default"
                  }
                >
                  {SERIES_ROLE_LABELS[organizer.role]}
                </Badge>
              </CardContent>
            </Card>
          ))}
        </div>
      </Section>

      <Section
        title="Custom roles"
        description={
          organizationId
            ? "Roles from your organization, plus any defined just for this series."
            : "For the jobs your club actually has. Nobody should have to be made an administrator to work the technical bay."
        }
        actions={
          <Button
            size="sm"
            variant="outline"
            onClick={() => setCreating((v) => !v)}
          >
            {creating ? "Cancel" : "New role"}
          </Button>
        }
      >
        {creating && (
          <RoleForm
            seriesId={seriesId}
            onSaved={() => {
              refresh();
              setCreating(false);
            }}
          />
        )}

        {roles.error && (
          <p className="text-sm text-brand-black/60">
            Only the series owner or an administrator can manage roles.
          </p>
        )}

        {roles.data?.length === 0 && !creating && (
          <EmptyState
            title="No custom roles"
            description="Create one for each job people do here — a scrutineer, a media officer, an assistant clerk."
            action={
              <Button
                size="sm"
                variant="primary"
                onClick={() => setCreating(true)}
              >
                Create a role
              </Button>
            }
          />
        )}

        <div className="space-y-2">
          {roles.data?.map((role) => (
            <Card key={role.id}>
              <CardContent className="space-y-3 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 font-medium">
                      <span
                        className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: role.color ?? "#0A0A0A" }}
                      />
                      {role.name}
                      {role.organizationId && (
                        <Badge variant="outline">From the organization</Badge>
                      )}
                    </p>
                    {role.description && (
                      <p className="text-xs text-brand-black/60">
                        {role.description}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {role.permissions.length === 0 ? (
                      <span className="text-xs text-brand-black/50">
                        No permissions — a title only.
                      </span>
                    ) : (
                      role.permissions.map((permission) => (
                        <span
                          key={permission}
                          className="rounded bg-brand-black/5 px-1.5 py-0.5 text-xs"
                        >
                          {PERMISSION_LABELS[permission]}
                        </span>
                      ))
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 border-t border-brand-black/10 pt-3">
                  {role.assignments.length === 0 ? (
                    <span className="text-xs text-brand-black/60">
                      Nobody holds this yet.
                    </span>
                  ) : (
                    role.assignments.map((assignment) => (
                      <span
                        key={assignment.id}
                        className="inline-flex items-center gap-1 rounded-full bg-brand-black/5 px-2.5 py-1 text-xs"
                      >
                        {assignment.user.profile?.displayName ?? "Someone"}
                        {assignment.event && ` · ${assignment.event.name} only`}
                        <button
                          type="button"
                          aria-label="Remove"
                          className="ml-0.5 opacity-60 hover:opacity-100"
                          onClick={() =>
                            unassign.mutate({ assignmentId: assignment.id })
                          }
                        >
                          ×
                        </button>
                      </span>
                    ))
                  )}

                  <select
                    aria-label={`Give someone the ${role.name} role`}
                    className="rounded-md border border-brand-black/20 px-2 py-1 text-xs"
                    value=""
                    onChange={(e) => {
                      if (!e.target.value) return;
                      assign.mutate({
                        staffRoleId: role.id,
                        userId: e.target.value,
                        seriesId,
                      });
                    }}
                  >
                    <option value="">Assign to…</option>
                    {organizers
                      .filter(
                        (organizer) =>
                          !role.assignments.some(
                            (assignment) =>
                              assignment.user.id === organizer.user.id,
                          ),
                      )
                      .map((organizer) => (
                        <option key={organizer.id} value={organizer.user.id}>
                          {organizer.user.profile?.displayName ?? "Unnamed"}
                        </option>
                      ))}
                  </select>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {(assign.error || unassign.error) && (
          <p className="text-sm text-brand-red">
            {assign.error?.message ?? unassign.error?.message}
          </p>
        )}

        <p className="text-xs text-brand-black/50">
          Only people already on the organizer list can be given a custom role
          here. Add them as an organizer first.
        </p>
      </Section>
    </div>
  );
}

function RoleForm({
  seriesId,
  onSaved,
}: {
  seriesId: string;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState("#D91E1E");
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const create = api.organization.createRole.useMutation({ onSuccess: onSaved });

  // Organization permissions are meaningless on a series-scoped role, so they
  // are not offered — a checkbox that cannot do anything is a question mark.
  const groups = PERMISSION_GROUPS.filter(
    (group) => group.label !== "Organization",
  );

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <label className="block text-sm font-medium">
            Role name
            <input
              className="mt-1 w-full rounded-md border border-brand-black/20 px-2 py-1.5 text-sm"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Chief Scrutineer"
            />
          </label>
          <label className="block text-sm font-medium">
            Colour
            <input
              type="color"
              className="mt-1 h-9 w-16 cursor-pointer rounded border border-brand-black/20 bg-white"
              value={color}
              onChange={(e) => setColor(e.target.value.toUpperCase())}
            />
          </label>
        </div>
        <label className="block text-sm font-medium">
          What this person does
          <input
            className="mt-1 w-full rounded-md border border-brand-black/20 px-2 py-1.5 text-sm"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>

        <div className="space-y-3">
          <p className="text-sm font-medium">What they can do</p>
          {groups.map((group) => (
            <div key={group.label} className="space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-brand-black/50">
                {group.label}
              </p>
              {group.permissions.map((permission) => (
                <label
                  key={permission}
                  className="flex items-start gap-2 text-sm"
                >
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={permissions.includes(permission)}
                    onChange={() =>
                      setPermissions((current) =>
                        current.includes(permission)
                          ? current.filter((p) => p !== permission)
                          : [...current, permission],
                      )
                    }
                  />
                  <span>
                    <span className="font-medium">
                      {PERMISSION_LABELS[permission]}
                    </span>
                    <span className="block text-xs text-brand-black/60">
                      {PERMISSION_DESCRIPTIONS[permission]}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          ))}
        </div>

        {create.error && (
          <p className="text-sm text-brand-red">{create.error.message}</p>
        )}
        <Button
          size="sm"
          variant="primary"
          disabled={create.isPending || name.trim().length === 0}
          onClick={() =>
            create.mutate({
              seriesId,
              name: name.trim(),
              description: description.trim() || undefined,
              permissions,
              color,
            })
          }
        >
          {create.isPending ? "Creating…" : "Create role"}
        </Button>
      </CardContent>
    </Card>
  );
}
