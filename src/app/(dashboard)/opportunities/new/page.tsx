"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { OpportunityType } from "@prisma/client";
import { api } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const TYPE_LABELS: Record<OpportunityType, string> = {
  SEAT: "Race seat",
  CREW_JOB: "Crew job",
  SPONSORSHIP: "Sponsorship",
};

export default function NewOpportunityPage() {
  const router = useRouter();
  const teams = api.team.myManagedTeams.useQuery();

  const [type, setType] = useState<OpportunityType>(OpportunityType.SEAT);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [compensation, setCompensation] = useState("");
  const [location, setLocation] = useState("");
  const [series, setSeries] = useState("");
  const [teamId, setTeamId] = useState("");

  const create = api.opportunity.create.useMutation({
    meta: { silenceError: true },
    onSuccess: () => router.push("/opportunities/mine"),
  });

  return (
    <Card className="mx-auto max-w-2xl">
      <CardHeader>
        <CardTitle>Post an opportunity</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Form
          busy={create.isPending}
          onSubmit={() =>
            create.mutate({
              type,
              title: title.trim(),
              description: description.trim(),
              compensation: compensation.trim() || undefined,
              location: location.trim() || undefined,
              series: series.trim() || undefined,
              teamId: teamId || undefined,
            })
          }
          className="space-y-3"
        >
          <div className="flex gap-2">
            {Object.values(OpportunityType).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setType(t)}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  type === t
                    ? "border-brand-red bg-brand-red text-white"
                    : "border-brand-black/20 hover:border-brand-red"
                }`}
              >
                {TYPE_LABELS[t]}
              </button>
            ))}
          </div>
          <label className="block text-sm font-medium">
            Title
            <input
              className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="GT3 endurance seat — 6h Spa"
            />
          </label>
          <label className="block text-sm font-medium">
            Description
            <textarea
              className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
              rows={5}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What you're offering, expectations, schedule…"
            />
          </label>
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="block text-sm font-medium">
              Compensation
              <input
                className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
                value={compensation}
                onChange={(e) => setCompensation(e.target.value)}
                placeholder="Paid drive / rev share"
              />
            </label>
            <label className="block text-sm font-medium">
              Location
              <input
                className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Remote / Spa"
              />
            </label>
            <label className="block text-sm font-medium">
              Series
              <input
                className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
                value={series}
                onChange={(e) => setSeries(e.target.value)}
                placeholder="IMSA / iRacing SEF"
              />
            </label>
          </div>
          <label className="block text-sm font-medium">
            Post as
            <select
              className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
              value={teamId}
              onChange={(e) => setTeamId(e.target.value)}
            >
              <option value="">Myself</option>
              {teams.data?.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name} (team — requires Recruiter tier)
                </option>
              ))}
            </select>
          </label>
          {create.error && (
            <p className="text-sm text-brand-red">{create.error.message}</p>
          )}
          <Button
            variant="primary"
            disabled={
              create.isPending ||
              title.trim().length < 4 ||
              description.trim().length < 10
            }
            type="submit"
          >
            {create.isPending ? "Posting…" : "Post opportunity"}
          </Button>
        </Form>
      </CardContent>
    </Card>
  );
}
