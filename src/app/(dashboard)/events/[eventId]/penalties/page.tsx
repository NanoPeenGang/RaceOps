"use client";

import { use, useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import { api } from "@/lib/trpc/client";
import type { AppRouter } from "@/server/trpc/root";
import {
  APPEAL_STATUS_LABELS,
  PENALTY_STATUS_LABELS,
  canAppeal,
  describePenalty,
} from "@/lib/penalties";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MediaPanel } from "@/components/media-panel";
import { ListSkeleton } from "@/components/ui/skeleton";

type Penalty = inferRouterOutputs<AppRouter>["penalty"]["forEvent"][number];

export default function EventPenaltiesPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = use(params);
  const event = api.event.byId.useQuery({ eventId });
  const penalties = api.penalty.forEvent.useQuery({ eventId });
  const mine = api.penalty.mine.useQuery();

  const myPenaltyIds = new Set(mine.data?.map((p) => p.id) ?? []);

  return (
    <div className="space-y-8">
      <PageHeader
        breadcrumbs={[
          { label: event.data?.name ?? "Event", href: `/events/${eventId}` },
          { label: "Penalties" },
        ]}
        title="Penalties &amp; appeals"
        description="Every decision issued by race control for this event is on the public record."
      />

      {penalties.isLoading && <ListSkeleton />}
      {penalties.data?.length === 0 && (
        <p className="text-brand-black/60">
          No penalties issued for this event.
        </p>
      )}

      <div className="space-y-4">
        {penalties.data?.map((penalty) => (
          <PenaltyCard
            key={penalty.id}
            penalty={penalty}
            canAppealThis={myPenaltyIds.has(penalty.id)}
            eventId={eventId}
          />
        ))}
      </div>

      <MediaPanel
        scope={{ eventId }}
        title="Event media"
        description="Post-race coverage, broadcast clips and race control footage."
        canManage={Boolean(event.data?.myRole)}
        allowOrganizerOnly
      />
    </div>
  );
}

function PenaltyCard({
  penalty,
  canAppealThis,
  eventId,
}: {
  penalty: Penalty;
  canAppealThis: boolean;
  eventId: string;
}) {
  const utils = api.useUtils();
  const [showAppeal, setShowAppeal] = useState(false);
  const [statement, setStatement] = useState("");

  const fileAppeal = api.penalty.fileAppeal.useMutation({
    meta: { silenceError: true, successMessage: "Appeal filed." },
    onSuccess: () => {
      setShowAppeal(false);
      setStatement("");
      utils.penalty.forEvent.invalidate({ eventId });
      utils.penalty.mine.invalidate();
    },
  });

  const competitor =
    penalty.registration.team?.name ??
    penalty.registration.entrantUser?.profile?.displayName ??
    "Unknown entry";

  const appealable =
    canAppealThis && canAppeal(penalty.status) && !penalty.appeal;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>
            {penalty.registration.carNumber
              ? `#${penalty.registration.carNumber} `
              : ""}
            {competitor}
          </CardTitle>
          <Badge
            variant={penalty.status === "OVERTURNED" ? "default" : "verified"}
          >
            {PENALTY_STATUS_LABELS[penalty.status]}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm font-semibold">{describePenalty(penalty)}</p>
        <p className="text-sm">{penalty.summary}</p>
        {penalty.details && (
          <p className="whitespace-pre-wrap text-sm text-brand-black/80">
            {penalty.details}
          </p>
        )}
        <p className="text-xs text-brand-black/60">
          {[
            penalty.regulation && `Art. ${penalty.regulation}`,
            penalty.lapNumber !== null && `Lap ${penalty.lapNumber}`,
            `Issued by ${penalty.issuedBy.profile?.displayName ?? "race control"}`,
            new Date(penalty.createdAt).toLocaleString(),
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>

        {penalty.media.length > 0 && (
          <div className="flex flex-wrap gap-3">
            {penalty.media.map((item) => (
              <a
                key={item.id}
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-medium text-brand-red hover:underline"
              >
                {item.title || `Evidence (${item.kind})`}
              </a>
            ))}
          </div>
        )}

        {penalty.appeal && (
          <div className="rounded-lg border border-brand-black/10 bg-brand-black/[0.02] p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold">Appeal</p>
              <Badge>{APPEAL_STATUS_LABELS[penalty.appeal.status]}</Badge>
            </div>
            <p className="mt-1 whitespace-pre-wrap text-sm text-brand-black/80">
              {penalty.appeal.statement}
            </p>
            {penalty.appeal.decision && (
              <p className="mt-2 whitespace-pre-wrap text-sm">
                <span className="font-medium">Decision: </span>
                {penalty.appeal.decision}
              </p>
            )}
          </div>
        )}

        {appealable && !showAppeal && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowAppeal(true)}
          >
            Appeal this penalty
          </Button>
        )}

        {showAppeal && (
          <div className="space-y-2">
            <label className="block text-sm font-medium">
              Grounds for appeal
              <textarea
                className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
                rows={4}
                value={statement}
                onChange={(e) => setStatement(e.target.value)}
                placeholder="Set out why the decision should be reviewed, referencing evidence…"
              />
            </label>
            <p className="text-xs text-brand-black/60">
              {statement.trim().length}/20 characters minimum. You can attach
              supporting media once the appeal is filed.
            </p>
            {fileAppeal.error && (
              <p className="text-xs text-brand-red">
                {fileAppeal.error.message}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="primary"
                disabled={fileAppeal.isPending || statement.trim().length < 20}
                onClick={() =>
                  fileAppeal.mutate({
                    penaltyId: penalty.id,
                    statement: statement.trim(),
                  })
                }
              >
                {fileAppeal.isPending ? "Filing…" : "Submit appeal"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setShowAppeal(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {penalty.appeal && canAppealThis && (
          <MediaPanel
            scope={{ appealId: penalty.appeal.id }}
            title="Appeal evidence"
            description="Attach footage or telemetry supporting your appeal."
            canManage
          />
        )}
      </CardContent>
    </Card>
  );
}
