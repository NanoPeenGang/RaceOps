"use client";

import { useState } from "react";
import { OpportunityType } from "@prisma/client";
import { api } from "@/lib/trpc/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const TYPE_LABELS: Record<OpportunityType, string> = {
  SEAT: "Race seat",
  CREW_JOB: "Crew job",
  SPONSORSHIP: "Sponsorship",
};

export default function OpportunitiesPage() {
  const [type, setType] = useState<OpportunityType | "">("");
  const list = api.opportunity.list.useQuery({
    type: type || undefined,
  });

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Opportunities</h1>
      <div className="flex gap-2">
        <FilterChip active={type === ""} onClick={() => setType("")}>
          All
        </FilterChip>
        {Object.values(OpportunityType).map((t) => (
          <FilterChip key={t} active={type === t} onClick={() => setType(t)}>
            {TYPE_LABELS[t]}
          </FilterChip>
        ))}
      </div>

      {list.isLoading && <p className="text-brand-black/60">Loading…</p>}
      {list.data?.items.length === 0 && (
        <p className="text-brand-black/60">
          No open opportunities in this category yet.
        </p>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {list.data?.items.map((item) => (
          <Card key={item.id}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>{item.title}</CardTitle>
                <Badge>{TYPE_LABELS[item.type]}</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="line-clamp-3 text-sm text-brand-black/80">
                {item.description}
              </p>
              <p className="text-xs text-brand-black/60">
                {[item.postedByTeam?.name, item.series, item.location]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              {item.compensation && (
                <p className="text-xs font-medium">{item.compensation}</p>
              )}
              <ApplyButton opportunityId={item.id} />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
        active
          ? "border-brand-red bg-brand-red text-white"
          : "border-brand-black/20 hover:border-brand-red"
      }`}
    >
      {children}
    </button>
  );
}

function ApplyButton({ opportunityId }: { opportunityId: string }) {
  const apply = api.opportunity.submitApplication.useMutation();
  return (
    <div>
      <Button
        size="sm"
        variant="primary"
        disabled={apply.isPending || apply.isSuccess}
        onClick={() => apply.mutate({ opportunityId })}
      >
        {apply.isSuccess ? "Applied" : apply.isPending ? "Applying…" : "Apply"}
      </Button>
      {apply.error && (
        <p className="mt-1 text-xs text-brand-red">{apply.error.message}</p>
      )}
    </div>
  );
}
