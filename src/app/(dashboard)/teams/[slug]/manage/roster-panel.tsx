"use client";

import { TeamRole } from "@prisma/client";
import { api } from "@/lib/trpc/client";
import { TEAM_ROLE_LABELS, isTeamManager, splitRoster } from "@/lib/teams";
import { roleTagsOf } from "@/lib/roles";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { TeamDashboard } from "./types";

/**
 * Drivers and staff. Roles are what drive access: owners and managers run the
 * team, everyone else is on the roster and in the team chat.
 */
export function RosterPanel({
  team,
  onChanged,
}: {
  team: TeamDashboard;
  onChanged: () => void;
}) {
  const canManage = isTeamManager(team.myRole);
  const setRole = api.team.setMemberRole.useMutation({ onSuccess: onChanged });
  const removeMember = api.team.removeMember.useMutation({
    onSuccess: onChanged,
  });

  const roster = splitRoster(
    team.roster.map((member) => ({
      ...member,
      startDate: new Date(member.startDate),
      endDate: member.endDate ? new Date(member.endDate) : null,
    })),
  );

  const error = setRole.error ?? removeMember.error;
  const isPending = setRole.isPending || removeMember.isPending;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-semibold">Roster</h2>
        <p className="text-sm text-brand-black/60">
          {roster.drivers.length} driver
          {roster.drivers.length === 1 ? "" : "s"} · {roster.staff.length} staff
        </p>
      </div>

      {!canManage && (
        <p className="text-sm text-brand-black/60">
          Owners and managers can change roles and take people off the roster.
        </p>
      )}

      {roster.active.length === 0 && (
        <p className="text-brand-black/60">
          Nobody on the roster yet. People join a team from its page.
        </p>
      )}

      <div className="space-y-2">
        {roster.active.map((member) => {
          const tags = member.user.profile ? roleTagsOf(member.user.profile) : [];
          const isMe = member.userId === team.myUserId;
          return (
            <Card key={member.id}>
              <CardContent className="space-y-3 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {member.user.profile?.displayName ?? "Unnamed"}
                      {isMe && (
                        <span className="ml-2 text-xs text-brand-black/50">
                          (you)
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-brand-black/60">
                      {[
                        member.user.profile?.location,
                        `since ${new Date(member.startDate).toLocaleDateString()}`,
                        tags
                          .slice(0, 3)
                          .map((tag) => tag.label)
                          .join(", "),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {member.user.verificationStatus === "VERIFIED" && (
                      <Badge variant="verified">Verified</Badge>
                    )}
                    <Badge>{TEAM_ROLE_LABELS[member.role]}</Badge>
                  </div>
                </div>

                {canManage && (
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      className="rounded-md border border-brand-black/20 px-2 py-1.5 text-xs"
                      value={member.role}
                      disabled={isPending}
                      onChange={(e) =>
                        setRole.mutate({
                          teamId: team.id,
                          userId: member.userId,
                          role: e.target.value as TeamRole,
                        })
                      }
                    >
                      {Object.values(TeamRole).map((role) => (
                        <option key={role} value={role}>
                          {TEAM_ROLE_LABELS[role]}
                        </option>
                      ))}
                    </select>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={isPending}
                      onClick={() =>
                        removeMember.mutate({
                          teamId: team.id,
                          userId: member.userId,
                        })
                      }
                    >
                      Remove
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {error && <p className="text-sm text-brand-red">{error.message}</p>}

      {roster.alumni.length > 0 && (
        <details className="rounded-md border border-brand-black/10 p-3">
          <summary className="cursor-pointer text-sm font-medium text-brand-black/70">
            Past members ({roster.alumni.length})
          </summary>
          <ul className="mt-3 space-y-1.5 text-sm">
            {roster.alumni.map((member) => (
              <li key={member.id} className="text-brand-black/70">
                {member.user.profile?.displayName ?? "Unnamed"} ·{" "}
                {TEAM_ROLE_LABELS[member.role]} · left{" "}
                {new Date(member.endDate!).toLocaleDateString()}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
