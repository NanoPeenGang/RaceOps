"use client";

import { useState } from "react";
import { OrgRole, Permission } from "@prisma/client";
import { api } from "@/lib/trpc/client";
import {
  ORG_ROLE_LABELS,
  PERMISSION_DESCRIPTIONS,
  PERMISSION_GROUPS,
  PERMISSION_LABELS,
} from "@/lib/permissions";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState, Section } from "@/components/ui/page";
import { ListSkeleton } from "@/components/ui/skeleton";

/**
 * The staff list and the roles behind it.
 *
 * People first, roles second. An organization thinks in terms of "who is the
 * chief scrutineer this season", not "which permission set exists" — putting
 * the permission model first is how an admin screen becomes something that
 * needs training.
 */
export function StaffPanel({ organizationId }: { organizationId: string }) {
  const utils = api.useUtils();
  const staff = api.organization.staff.useQuery(
    { organizationId },
    { meta: { silenceError: true } },
  );
  const [addingMember, setAddingMember] = useState(false);
  const [addingRole, setAddingRole] = useState(false);

  const refresh = () => utils.organization.staff.invalidate({ organizationId });
  const assign = api.organization.assignRole.useMutation({
    meta: { silenceError: true },
    onSuccess: refresh,
  });
  const unassign = api.organization.unassignRole.useMutation({
    onSuccess: refresh,
  });
  const removeMember = api.organization.removeMember.useMutation({
    onSuccess: refresh,
  });

  if (staff.isLoading) return <ListSkeleton />;
  if (staff.error)
    return <p className="text-brand-red">{staff.error.message}</p>;
  const { members, roles } = staff.data!;

  return (
    <div className="space-y-8">
      <Section
        title="People"
        description="Everyone who helps run this organization, and what they are allowed to do."
        actions={
          <Button
            size="sm"
            variant="primary"
            onClick={() => setAddingMember((v) => !v)}
          >
            {addingMember ? "Cancel" : "Add someone"}
          </Button>
        }
      >
        {addingMember && (
          <AddMemberForm
            organizationId={organizationId}
            onAdded={() => {
              refresh();
              setAddingMember(false);
            }}
          />
        )}

        <div className="space-y-2">
          {members.map((member) => (
            <Card key={member.id}>
              <CardContent className="space-y-3 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar name={member.user.profile?.displayName} size="sm" />
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {member.user.profile?.displayName ?? member.user.email}
                      </p>
                      <p className="text-xs text-brand-black/60">
                        {[member.title, member.user.email]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant={
                        member.role === OrgRole.OWNER ? "verified" : "default"
                      }
                    >
                      {ORG_ROLE_LABELS[member.role]}
                    </Badge>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={removeMember.isPending}
                      onClick={() =>
                        removeMember.mutate({ membershipId: member.id })
                      }
                    >
                      Remove
                    </Button>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 border-t border-brand-black/10 pt-3">
                  {member.assignments.length === 0 ? (
                    <p className="text-xs text-brand-black/60">
                      No roles yet — being a member grants nothing on its own.
                    </p>
                  ) : (
                    member.assignments.map((assignment) => (
                      <span
                        key={assignment.id}
                        className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium"
                        style={{
                          backgroundColor: `${assignment.staffRole.color ?? "#0A0A0A"}18`,
                          color: assignment.staffRole.color ?? undefined,
                        }}
                      >
                        {assignment.staffRole.name}
                        {assignment.series && ` · ${assignment.series.name}`}
                        {assignment.event && ` · ${assignment.event.name}`}
                        <button
                          type="button"
                          aria-label={`Remove ${assignment.staffRole.name}`}
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

                  {roles.length > 0 && (
                    <select
                      aria-label={`Give ${member.user.profile?.displayName ?? "them"} a role`}
                      className="rounded-md border border-brand-black/20 px-2 py-1 text-xs"
                      value=""
                      onChange={(e) => {
                        if (!e.target.value) return;
                        assign.mutate({
                          staffRoleId: e.target.value,
                          userId: member.user.id,
                        });
                      }}
                    >
                      <option value="">Give a role…</option>
                      {roles
                        .filter(
                          (role) =>
                            !member.assignments.some(
                              (assignment) =>
                                assignment.staffRole.id === role.id &&
                                !assignment.series &&
                                !assignment.event,
                            ),
                        )
                        .map((role) => (
                          <option key={role.id} value={role.id}>
                            {role.name}
                          </option>
                        ))}
                    </select>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
        {(assign.error || unassign.error || removeMember.error) && (
          <p className="text-sm text-brand-red">
            {assign.error?.message ??
              unassign.error?.message ??
              removeMember.error?.message}
          </p>
        )}
      </Section>

      <Section
        title="Roles"
        description="A role is a set of permissions with a name your club actually uses."
        actions={
          <Button
            size="sm"
            variant="outline"
            onClick={() => setAddingRole((v) => !v)}
          >
            {addingRole ? "Cancel" : "New role"}
          </Button>
        }
      >
        {addingRole && (
          <RoleForm
            organizationId={organizationId}
            onSaved={() => {
              refresh();
              setAddingRole(false);
            }}
          />
        )}

        {roles.length === 0 ? (
          <EmptyState
            title="No roles yet"
            description="Create one for each job people do here."
          />
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {roles.map((role) => (
              <Card key={role.id}>
                <CardContent className="space-y-2 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex items-center gap-2 font-medium">
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: role.color ?? "#0A0A0A" }}
                      />
                      {role.name}
                    </span>
                    <span className="text-xs text-brand-black/60">
                      {role._count.assignments}{" "}
                      {role._count.assignments === 1 ? "person" : "people"}
                    </span>
                  </div>
                  {role.description && (
                    <p className="text-xs text-brand-black/60">
                      {role.description}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-1">
                    {role.permissions.length === 0 ? (
                      <span className="text-xs text-brand-black/50">
                        A title with no permissions.
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
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

function AddMemberForm({
  organizationId,
  onAdded,
}: {
  organizationId: string;
  onAdded: () => void;
}) {
  const [email, setEmail] = useState("");
  const [title, setTitle] = useState("");
  const [role, setRole] = useState<OrgRole>(OrgRole.STAFF);
  const add = api.organization.addMember.useMutation({ onSuccess: onAdded });

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <p className="text-xs text-brand-black/60">
          They need a RaceOps account already — ask them to sign up first, then
          add the address they used.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block text-sm font-medium sm:col-span-2">
            Email
            <input
              type="email"
              className="mt-1 w-full rounded-md border border-brand-black/20 px-2 py-1.5 text-sm"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label className="block text-sm font-medium">
            Level
            <select
              className="mt-1 w-full rounded-md border border-brand-black/20 px-2 py-1.5 text-sm"
              value={role}
              onChange={(e) => setRole(e.target.value as OrgRole)}
            >
              {Object.entries(ORG_ROLE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="block text-sm font-medium">
          Title <span className="text-brand-black/50">(optional)</span>
          <input
            className="mt-1 w-full rounded-md border border-brand-black/20 px-2 py-1.5 text-sm"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Clerk of the Course"
          />
        </label>
        {add.error && (
          <p className="text-sm text-brand-red">{add.error.message}</p>
        )}
        <Button
          size="sm"
          variant="primary"
          disabled={add.isPending || !email.includes("@")}
          onClick={() =>
            add.mutate({
              organizationId,
              email: email.trim(),
              role,
              title: title.trim() || undefined,
            })
          }
        >
          {add.isPending ? "Adding…" : "Add to organization"}
        </Button>
      </CardContent>
    </Card>
  );
}

function RoleForm({
  organizationId,
  onSaved,
}: {
  organizationId: string;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState("#D91E1E");
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const create = api.organization.createRole.useMutation({
    onSuccess: onSaved,
  });

  const toggle = (permission: Permission) =>
    setPermissions((current) =>
      current.includes(permission)
        ? current.filter((p) => p !== permission)
        : [...current, permission],
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
            placeholder="Runs the technical bay and refers cars to the stewards."
          />
        </label>

        <div className="space-y-3">
          <p className="text-sm font-medium">What they can do</p>
          {/* Grouped, with each permission's consequence spelled out. A bare
              list of enum names is where an admin screen starts needing
              training. */}
          {PERMISSION_GROUPS.map((group) => (
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
                    onChange={() => toggle(permission)}
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
          <p className="text-xs text-brand-black/50">
            You can only grant what you hold yourself.
          </p>
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
              organizationId,
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
