"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/trpc/client";
import { TEAM_ROLE_LABELS } from "@/lib/teams";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function TeamsPage() {
  const utils = api.useUtils();
  const teams = api.team.list.useQuery({});
  const myTeams = api.team.myTeams.useQuery();
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const createTeam = api.team.create.useMutation({
    meta: { silenceError: true },
    onSuccess: (team) => {
      setName("");
      setDescription("");
      utils.team.list.invalidate();
      utils.team.myTeams.invalidate();
      // The creator is the owner, so drop them straight into the console.
      router.push(`/teams/${team.slug}/manage`);
    },
  });

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-bold">Teams</h1>

      {myTeams.data && myTeams.data.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">My teams</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {myTeams.data.map((team) => (
              <Card key={team.id}>
                <CardHeader>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle>{team.name}</CardTitle>
                    <Badge variant="verified">
                      {TEAM_ROLE_LABELS[team.myRole]}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-2">
                  <Link href={`/teams/${team.slug}/manage`}>
                    <Button size="sm" variant="primary">
                      Team console
                    </Button>
                  </Link>
                  <Link href={`/teams/${team.slug}`}>
                    <Button size="sm" variant="outline">
                      Public page
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}

      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>Create a team</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Form
            busy={createTeam.isPending}
            onSubmit={() =>
              createTeam.mutate({
                name: name.trim(),
                description: description.trim() || undefined,
              })
            }
            className="space-y-3"
          >
            <input
              className="w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
              placeholder="Team name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <textarea
              className="w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
              placeholder="What does your team run?"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            {createTeam.error && (
              <p className="text-sm text-brand-red">
                {createTeam.error.message}
              </p>
            )}
            <Button
              variant="primary"
              disabled={createTeam.isPending || name.trim().length < 2}
              type="submit"
            >
              {createTeam.isPending ? "Creating…" : "Create team"}
            </Button>
          </Form>
        </CardContent>
      </Card>

      {teams.isLoading && <p className="text-brand-black/60">Loading teams…</p>}
      <div className="grid gap-4 md:grid-cols-2">
        {teams.data?.teams.map((team) => (
          <Card key={team.id}>
            <CardHeader>
              <CardTitle>
                <Link
                  href={`/teams/${team.slug}`}
                  className="hover:text-brand-red"
                >
                  {team.name}
                </Link>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {team.description && (
                <p className="line-clamp-3 text-sm text-brand-black/80">
                  {team.description}
                </p>
              )}
              <p className="text-xs text-brand-black/60">
                {team._count.roster} member{team._count.roster === 1 ? "" : "s"}
              </p>
              <div className="flex flex-wrap gap-2">
                <Link href={`/teams/${team.slug}`}>
                  <Button size="sm" variant="outline">
                    View team
                  </Button>
                </Link>
                <JoinButton teamId={team.id} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function JoinButton({ teamId }: { teamId: string }) {
  const utils = api.useUtils();
  const join = api.team.join.useMutation({
    onSuccess: () => utils.team.list.invalidate(),
  });
  return (
    <div>
      <Button
        size="sm"
        variant="outline"
        disabled={join.isPending || join.isSuccess}
        onClick={() => join.mutate({ teamId })}
      >
        {join.isSuccess ? "Joined" : join.isPending ? "Joining…" : "Join team"}
      </Button>
      {join.error && (
        <p className="mt-1 text-xs text-brand-red">{join.error.message}</p>
      )}
    </div>
  );
}
