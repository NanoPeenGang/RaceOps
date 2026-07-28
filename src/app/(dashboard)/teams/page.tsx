"use client";

import { useState } from "react";
import { api } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function TeamsPage() {
  const utils = api.useUtils();
  const teams = api.team.list.useQuery({});
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const createTeam = api.team.create.useMutation({
    onSuccess: () => {
      setName("");
      setDescription("");
      utils.team.list.invalidate();
    },
  });

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-bold">Teams</h1>

      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>Create a team</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
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
            <p className="text-sm text-brand-red">{createTeam.error.message}</p>
          )}
          <Button
            variant="primary"
            disabled={createTeam.isPending || name.trim().length < 2}
            onClick={() =>
              createTeam.mutate({
                name: name.trim(),
                description: description.trim() || undefined,
              })
            }
          >
            {createTeam.isPending ? "Creating…" : "Create team"}
          </Button>
        </CardContent>
      </Card>

      {teams.isLoading && <p className="text-brand-black/60">Loading teams…</p>}
      <div className="grid gap-4 md:grid-cols-2">
        {teams.data?.teams.map((team) => (
          <Card key={team.id}>
            <CardHeader>
              <CardTitle>{team.name}</CardTitle>
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
              <JoinButton teamId={team.id} />
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
