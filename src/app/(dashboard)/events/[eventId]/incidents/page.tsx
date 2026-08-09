"use client";

import { use, useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import Link from "next/link";
import { IncidentSource, IncidentStatus, PenaltyType } from "@prisma/client";
import { api } from "@/lib/trpc/client";
import type { AppRouter } from "@/server/trpc/root";
import {
  INCIDENT_SOURCE_LABELS,
  INCIDENT_STATUS_LABELS,
  describeIncidentLocation,
  isIncidentOpen,
  nextIncidentStatuses,
} from "@/lib/incidents";
import { PENALTY_TYPE_LABELS } from "@/lib/penalties";
import { turnLabel } from "@/lib/tracks";
import { useOffline } from "@/components/offline-provider";
import { useOfflineMutation } from "@/lib/trpc/offline-mutation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ListSkeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/ui/page";

/**
 * The stewards' queue: reports in, decisions out.
 *
 * Officials see everything; everyone else sees decided reports, because a
 * stewards' decision is a public record but an open investigation is not.
 */
export default function IncidentsPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = use(params);
  const utils = api.useUtils();
  const event = api.event.byId.useQuery({ eventId });
  const queue = api.incident.forEvent.useQuery(
    { eventId },
    { meta: { silenceError: true } },
  );
  const [showForm, setShowForm] = useState(false);

  const refresh = () => {
    utils.incident.forEvent.invalidate({ eventId });
    utils.penalty.forEvent.invalidate({ eventId });
  };

  if (queue.isLoading) return <ListSkeleton />;
  if (queue.error)
    return <p className="text-brand-red">{queue.error.message}</p>;

  const { incidents, summary, isOfficial } = queue.data!;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/events/${eventId}`}
          className="text-sm text-brand-red hover:underline"
        >
          ← {event.data?.name ?? "Event"}
        </Link>
        <PageHeader
          title="Incidents"
          description={
            isOfficial
              ? `${summary.open} open · ${summary.investigating} under investigation · ${summary.protests} protest${summary.protests === 1 ? "" : "s"} · ${summary.closed} closed`
              : "Decided reports are published here; open investigations are not."
          }
          actions={
            <>
              <Button variant="primary" onClick={() => setShowForm((v) => !v)}>
                {showForm ? "Cancel" : "Report an incident"}
              </Button>
            </>
          }
        />
      </div>

      {showForm && (
        <ReportForm
          eventId={eventId}
          isOfficial={isOfficial}
          onFiled={() => {
            setShowForm(false);
            refresh();
          }}
        />
      )}

      {incidents.length === 0 && (
        <p className="text-brand-black/60">Nothing reported yet.</p>
      )}

      <div className="space-y-2">
        {incidents.map((incident) => (
          <IncidentRow
            key={incident.id}
            incident={incident}
            isOfficial={isOfficial}
            onChanged={refresh}
          />
        ))}
      </div>
    </div>
  );
}

type QueueIncident =
  inferRouterOutputs<AppRouter>["incident"]["forEvent"]["incidents"][number];

function IncidentRow({
  incident,
  isOfficial,
  onChanged,
}: {
  incident: QueueIncident;
  isOfficial: boolean;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const setStatus = api.incident.setStatus.useMutation({
    meta: { silenceError: true },
    onSuccess: onChanged,
  });
  const withdraw = api.incident.withdraw.useMutation({ onSuccess: onChanged });
  const [notes, setNotes] = useState("");
  const [showPenalty, setShowPenalty] = useState(false);

  const subjectLabel =
    incident.subject?.team?.name ??
    incident.subject?.entrantUser?.profile?.displayName ??
    (incident.subject ? "Entry" : "No entry named");

  return (
    <Card
      className={
        incident.source === IncidentSource.PROTEST &&
        isIncidentOpen(incident.status)
          ? "border-brand-red/40"
          : undefined
      }
    >
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-medium">{incident.summary}</p>
            <p className="text-xs text-brand-black/60">
              {[
                INCIDENT_SOURCE_LABELS[incident.source],
                incident.subject
                  ? `${incident.subject.carNumber ? `#${incident.subject.carNumber} ` : ""}${subjectLabel}`
                  : null,
                describeIncidentLocation(incident),
                incident.session?.name,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant={
                incident.status === IncidentStatus.PENALTY_ISSUED
                  ? "verified"
                  : "default"
              }
            >
              {INCIDENT_STATUS_LABELS[incident.status]}
            </Badge>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setOpen((v) => !v)}
            >
              {open ? "Close" : "Open"}
            </Button>
          </div>
        </div>

        {open && (
          <div className="space-y-3 border-t border-brand-black/10 pt-3 text-sm">
            {incident.description && (
              <p className="whitespace-pre-wrap text-brand-black/80">
                {incident.description}
              </p>
            )}
            {incident.decisionNotes && (
              <p className="rounded-md bg-brand-black/5 p-3 text-brand-black/80">
                <span className="font-medium">Decision: </span>
                {incident.decisionNotes}
              </p>
            )}
            {incident.penalty && (
              <p className="text-brand-red">
                Penalty issued — {incident.penalty.summary}
              </p>
            )}

            {isOfficial && isIncidentOpen(incident.status) && (
              <div className="space-y-2">
                <textarea
                  rows={2}
                  className="w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
                  placeholder="Decision notes (recorded with the outcome)"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
                <div className="flex flex-wrap gap-2">
                  {nextIncidentStatuses(incident.status).map((status) => (
                    <Button
                      key={status}
                      size="sm"
                      variant="outline"
                      disabled={setStatus.isPending}
                      onClick={() =>
                        setStatus.mutate({
                          incidentId: incident.id,
                          status,
                          decisionNotes: notes.trim() || undefined,
                        })
                      }
                    >
                      {INCIDENT_STATUS_LABELS[status]}
                    </Button>
                  ))}
                  {incident.subject && (
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() => setShowPenalty((v) => !v)}
                    >
                      {showPenalty ? "Cancel penalty" : "Issue penalty"}
                    </Button>
                  )}
                </div>
              </div>
            )}

            {showPenalty && (
              <PenaltyForm incidentId={incident.id} onIssued={onChanged} />
            )}

            {setStatus.error && (
              <p className="text-brand-red">{setStatus.error.message}</p>
            )}

            {isIncidentOpen(incident.status) && (
              <Button
                size="sm"
                variant="ghost"
                disabled={withdraw.isPending}
                onClick={() => withdraw.mutate({ incidentId: incident.id })}
              >
                Withdraw my report
              </Button>
            )}
            {withdraw.error && (
              <p className="text-xs text-brand-black/60">
                {withdraw.error.message}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PenaltyForm({
  incidentId,
  onIssued,
}: {
  incidentId: string;
  onIssued: () => void;
}) {
  const [type, setType] = useState<PenaltyType>(PenaltyType.TIME_PENALTY);
  const [summary, setSummary] = useState("");
  const [timeSeconds, setTimeSeconds] = useState("");
  const [pointsDeducted, setPointsDeducted] = useState("");
  const [regulation, setRegulation] = useState("");

  const issue = api.incident.issuePenalty.useMutation({ onSuccess: onIssued });

  return (
    <div className="space-y-3 rounded-md border border-brand-black/10 p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm font-medium">
          Penalty
          <select
            className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
            value={type}
            onChange={(e) => setType(e.target.value as PenaltyType)}
          >
            {Object.values(PenaltyType).map((option) => (
              <option key={option} value={option}>
                {PENALTY_TYPE_LABELS[option]}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-medium">
          Summary
          <input
            className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="Causing a collision"
          />
        </label>
        {type === PenaltyType.TIME_PENALTY && (
          <label className="block text-sm font-medium">
            Seconds
            <input
              inputMode="numeric"
              className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
              value={timeSeconds}
              onChange={(e) => setTimeSeconds(e.target.value)}
            />
          </label>
        )}
        {type === PenaltyType.POINTS_DEDUCTION && (
          <label className="block text-sm font-medium">
            Points deducted
            <input
              inputMode="numeric"
              className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
              value={pointsDeducted}
              onChange={(e) => setPointsDeducted(e.target.value)}
            />
          </label>
        )}
        <label className="block text-sm font-medium">
          Regulation <span className="text-brand-black/50">(optional)</span>
          <input
            className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
            value={regulation}
            onChange={(e) => setRegulation(e.target.value)}
            placeholder="Art. 27.4"
          />
        </label>
      </div>
      {issue.error && (
        <p className="text-sm text-brand-red">{issue.error.message}</p>
      )}
      <Button
        size="sm"
        variant="primary"
        disabled={issue.isPending || summary.trim().length < 3}
        onClick={() =>
          issue.mutate({
            incidentId,
            type,
            summary: summary.trim(),
            regulation: regulation.trim() || undefined,
            timeSeconds:
              type === PenaltyType.TIME_PENALTY && timeSeconds.trim()
                ? Number(timeSeconds)
                : undefined,
            pointsDeducted:
              type === PenaltyType.POINTS_DEDUCTION && pointsDeducted.trim()
                ? Number(pointsDeducted)
                : undefined,
          })
        }
      >
        {issue.isPending ? "Issuing…" : "Issue penalty & close report"}
      </Button>
    </div>
  );
}

function ReportForm({
  eventId,
  isOfficial,
  onFiled,
}: {
  eventId: string;
  isOfficial: boolean;
  onFiled: () => void;
}) {
  const entries = api.lineup.forEvent.useQuery({ eventId });
  const [subjectId, setSubjectId] = useState("");
  const [source, setSource] = useState<IncidentSource>(
    IncidentSource.COMPETITOR,
  );
  const [summary, setSummary] = useState("");
  const [description, setDescription] = useState("");
  const [lapNumber, setLapNumber] = useState("");
  const [location, setLocation] = useState("");
  const [turnId, setTurnId] = useState("");

  const file = api.incident.file.useMutation({
    meta: { successMessage: "Incident filed with the stewards." },
    onSuccess: onFiled,
  });
  // Marshal posts are exactly where signal fails, and a report written on
  // paper at the post is a report that arrives an hour late or not at all.
  const offlineFile = useOfflineMutation(
    (input: Parameters<typeof file.mutateAsync>[0]) => file.mutateAsync(input),
    {
      procedure: "incident.file",
      label: (input) => `Incident: ${input.summary}`,
    },
  );
  const { online } = useOffline();

  // Corners are only offered when the event runs a layout that defines them;
  // everywhere else the free-text "Where" field is the whole story.
  const event = api.event.byId.useQuery({ eventId });
  const turns = event.data?.trackLayout?.turns ?? [];

  // Only officials may file as race control or a marshal post.
  const sources = isOfficial
    ? Object.values(IncidentSource)
    : [IncidentSource.COMPETITOR, IncidentSource.PROTEST];

  return (
    <Card className="max-w-2xl">
      <CardContent className="space-y-4 p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-medium">
            Kind
            <select
              className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
              value={source}
              onChange={(e) => setSource(e.target.value as IncidentSource)}
            >
              {sources.map((option) => (
                <option key={option} value={option}>
                  {INCIDENT_SOURCE_LABELS[option]}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-medium">
            About which entry
            <select
              className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
              value={subjectId}
              onChange={(e) => setSubjectId(e.target.value)}
            >
              <option value="">No specific entry</option>
              {entries.data?.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.carNumber ? `#${entry.carNumber} ` : ""}
                  {entry.team?.name ??
                    entry.entrantUser?.profile?.displayName ??
                    "Entry"}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-medium">
            Lap <span className="text-brand-black/50">(optional)</span>
            <input
              inputMode="numeric"
              className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
              value={lapNumber}
              onChange={(e) => setLapNumber(e.target.value)}
            />
          </label>
          {turns.length > 0 && (
            <label className="block text-sm font-medium">
              Corner <span className="text-brand-black/50">(optional)</span>
              <select
                className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
                value={turnId}
                onChange={(e) => setTurnId(e.target.value)}
              >
                <option value="">Not a corner</option>
                {turns.map((turn) => (
                  <option key={turn.id} value={turn.id}>
                    {turnLabel(turn)}
                    {turn.marshalPost ? ` · ${turn.marshalPost}` : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="block text-sm font-medium">
            Where <span className="text-brand-black/50">(optional)</span>
            <input
              className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder={
                turns.length > 0
                  ? "pit exit · recovery road"
                  : "Turn 5 · pit exit"
              }
            />
          </label>
        </div>
        <label className="block text-sm font-medium">
          What happened
          <input
            className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="Contact at the apex, car spun"
          />
        </label>
        <label className="block text-sm font-medium">
          Detail <span className="text-brand-black/50">(optional)</span>
          <textarea
            rows={4}
            className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        {file.error && (
          <p className="text-sm text-brand-red">{file.error.message}</p>
        )}
        {!online && (
          <p className="text-sm text-brand-black/70">
            No signal. This report will be held and sent as soon as you are back
            in coverage — the time you filed it is what gets recorded.
          </p>
        )}
        <Button
          variant="primary"
          disabled={file.isPending || summary.trim().length < 5}
          onClick={() =>
            void offlineFile
              .run({
                eventId,
                source,
                subjectRegistrationId: subjectId || undefined,
                summary: summary.trim(),
                description: description.trim() || undefined,
                lapNumber: lapNumber.trim() ? Number(lapNumber) : undefined,
                location: location.trim() || undefined,
                turnId: turnId || undefined,
                // The moment it happened, not the moment it was delivered.
                occurredAt: new Date(),
              })
              .then(({ queued }) => {
                if (queued) onFiled();
              })
          }
        >
          {file.isPending ? "Filing…" : online ? "File report" : "Hold report"}
        </Button>
      </CardContent>
    </Card>
  );
}
