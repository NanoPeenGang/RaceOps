"use client";

import { useState } from "react";
import Link from "next/link";
import {
  AccessRequestKind,
  AccessRequestStatus,
  PlatformRole,
} from "@prisma/client";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/trpc/root";
import { api } from "@/lib/trpc/client";
import {
  ACCESS_KIND_CRITERIA,
  ACCESS_KIND_LABELS,
  ACCESS_STATUS_LABELS,
  daysPending,
  isOverdue,
  REVIEW_SLA_DAYS,
} from "@/lib/access-requests";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState, PageHeader, Section, Stat } from "@/components/ui/page";
import { Tabs } from "@/components/ui/tabs";

/**
 * The review queue.
 *
 * The job here is to make a decision cheap and an unfair one expensive. Every
 * card carries the applicant next to the application — how long they have been
 * on the platform, whether they are verified, what they wrote — because a
 * reviewer deciding from a name alone will decide by vibes, and inconsistently.
 * The bar for the kind is printed on the card for the same reason.
 */

type QueueData = inferRouterOutputs<AppRouter>["access"]["queue"];
type QueueRow = QueueData["requests"][number];

export default function AccessQueuePage() {
  const [status, setStatus] = useState<AccessRequestStatus | undefined>(
    AccessRequestStatus.PENDING,
  );
  const queue = api.access.queue.useQuery({ status });

  if (queue.error) {
    return (
      <EmptyState
        title="Not your queue"
        description={queue.error.message}
        action={
          <Link href="/home">
            <Button variant="primary">Back to home</Button>
          </Link>
        }
      />
    );
  }

  const data = queue.data;
  const overdue = (data?.requests ?? []).filter((r) => isOverdue(r)).length;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Access applications"
        description={`Teams, organizations, championships and sponsor accounts waiting on a human. Target is ${REVIEW_SLA_DAYS} days — an unanswered application blocks somebody from using the platform at all.`}
        breadcrumbs={[{ label: "Admin" }, { label: "Access" }]}
      />

      {data && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label="Waiting" value={data.pendingTotal} />
          <Stat
            label={`Over ${REVIEW_SLA_DAYS} days`}
            value={overdue}
            tone={overdue > 0 ? "alert" : "default"}
            hint={overdue > 0 ? "Somebody has been waiting." : undefined}
          />
          <Stat
            label="Biggest queue"
            value={biggestQueue(data.pendingByKind)}
          />
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {[
          { label: "Waiting", value: AccessRequestStatus.PENDING },
          { label: "Approved", value: AccessRequestStatus.APPROVED },
          { label: "Declined", value: AccessRequestStatus.REJECTED },
          { label: "All", value: undefined },
        ].map((option) => (
          <Button
            key={option.label}
            variant={status === option.value ? "primary" : "outline"}
            onClick={() => setStatus(option.value)}
          >
            {option.label}
          </Button>
        ))}
      </div>

      <Tabs
        tabs={[
          {
            id: "queue",
            label: "Queue",
            badge: data?.pendingTotal || undefined,
            content: (
              <div className="space-y-3 pt-4">
                {queue.isLoading && (
                  <p className="text-brand-black/60">Loading…</p>
                )}
                {data?.requests.length === 0 && (
                  <EmptyState
                    title="Nothing here"
                    description="No applications match this filter."
                  />
                )}
                {data?.requests.map((request) => (
                  <ReviewCard key={request.id} request={request} />
                ))}
              </div>
            ),
          },
          {
            id: "staff",
            label: "Platform staff",
            content: <StaffPanel />,
          },
        ]}
      />
    </div>
  );
}

function biggestQueue(
  byKind: Partial<Record<AccessRequestKind, number>>,
): string {
  const entries = Object.entries(byKind) as [AccessRequestKind, number][];
  if (entries.length === 0) return "—";
  const top = entries.sort((a, b) => b[1] - a[1])[0]!;
  return `${ACCESS_KIND_LABELS[top[0]]} (${top[1]})`;
}

function ReviewCard({ request }: { request: QueueRow }) {
  const utils = api.useUtils();
  const [note, setNote] = useState("");
  const decide = api.access.decide.useMutation({
    onSuccess: () => utils.access.queue.invalidate(),
  });

  const pending = request.status === AccessRequestStatus.PENDING;
  const late = isOverdue(request);
  const applicant = request.requestedBy;
  const accountAgeDays = daysPending({
    status: AccessRequestStatus.PENDING,
    createdAt: applicant.createdAt,
  });

  return (
    <Card className={late ? "border-brand-red/40" : undefined}>
      <CardContent className="space-y-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-lg font-semibold">
                {request.proposedName}
              </h3>
              <Badge variant="outline">
                {ACCESS_KIND_LABELS[request.kind]}
              </Badge>
              <Badge
                variant={
                  request.status === AccessRequestStatus.APPROVED
                    ? "verified"
                    : "default"
                }
              >
                {ACCESS_STATUS_LABELS[request.status]}
              </Badge>
            </div>
            <p className="mt-1 text-xs text-brand-black/60">
              {pending
                ? `Waiting ${daysPending(request)} day(s)`
                : request.reviewedAt
                  ? `Decided ${new Date(request.reviewedAt).toLocaleDateString()}${
                      request.reviewedBy?.profile?.displayName
                        ? ` by ${request.reviewedBy.profile.displayName}`
                        : ""
                    }`
                  : null}
            </p>
          </div>
          {late && <Badge variant="verified">Overdue</Badge>}
        </div>

        {/* The applicant, next to what they wrote. Deciding from the name
            alone is how a queue becomes arbitrary. */}
        <div className="flex items-center gap-3 rounded-md bg-brand-black/[0.03] p-3">
          <Avatar
            src={applicant.profile?.avatarUrl}
            name={applicant.profile?.displayName ?? applicant.email}
            size="sm"
          />
          <div className="min-w-0 text-sm">
            <p className="truncate font-medium">
              {applicant.profile?.displayName ?? applicant.email}
            </p>
            <p className="text-xs text-brand-black/60">
              {[
                `account ${accountAgeDays} day(s) old`,
                applicant.profile?.location,
                applicant.verificationStatus,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
        </div>

        <div className="space-y-2 text-sm">
          <p className="whitespace-pre-wrap">{request.summary}</p>
          {request.experience && (
            <p className="whitespace-pre-wrap text-brand-black/70">
              {request.experience}
            </p>
          )}
          {request.websiteUrl && (
            <a
              className="inline-block break-all text-sm underline"
              href={request.websiteUrl}
              target="_blank"
              rel="noreferrer noopener"
            >
              {request.websiteUrl}
            </a>
          )}
        </div>

        {request.decisionNote && !pending && (
          <p className="rounded-md border border-brand-black/10 p-3 text-sm">
            {request.decisionNote}
          </p>
        )}

        {pending && (
          <div className="space-y-3 border-t border-brand-black/10 pt-4">
            <p className="text-xs text-brand-black/60">
              <span className="font-semibold">The bar: </span>
              {ACCESS_KIND_CRITERIA[request.kind]}
            </p>
            <textarea
              className="w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
              rows={2}
              maxLength={2000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Note to the applicant. Required to decline — they need to know whether it is worth trying again."
            />
            {decide.error && (
              <p className="text-sm text-brand-red">{decide.error.message}</p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="primary"
                disabled={decide.isPending}
                onClick={() =>
                  decide.mutate({
                    requestId: request.id,
                    approve: true,
                    note: note.trim() || null,
                  })
                }
              >
                Approve
              </Button>
              <Button
                variant="outline"
                disabled={decide.isPending || !note.trim()}
                onClick={() =>
                  decide.mutate({
                    requestId: request.id,
                    approve: false,
                    note: note.trim(),
                  })
                }
              >
                Decline
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const ROLE_LABELS: Record<PlatformRole, string> = {
  MEMBER: "Member",
  MODERATOR: "Moderator — reviews applications",
  ADMIN: "Admin — reviews applications and appoints staff",
};

function StaffPanel() {
  const utils = api.useUtils();
  const [lookup, setLookup] = useState("");
  const [query, setQuery] = useState<string | undefined>();
  const staff = api.access.staff.useQuery({ query });
  const setRole = api.access.setPlatformRole.useMutation({
    onSuccess: () => utils.access.staff.invalidate(),
  });

  if (!staff.data) return <p className="pt-4 text-brand-black/60">Loading…</p>;

  return (
    <div className="space-y-4 pt-4">
      {!staff.data.hasBootstrapAdmin && staff.data.staff.length === 0 && (
        <Card className="border-brand-red/40">
          <CardContent className="p-4 text-sm">
            Nobody can review applications and{" "}
            <code>PLATFORM_ADMIN_EMAILS</code> is not set on this deployment.
            Set it to at least one address, or the queue stops being read.
          </CardContent>
        </Card>
      )}

      <Section
        title="Who can review"
        description="Moderators read the queue. Admins do that and appoint other staff."
      >
        {staff.data.staff.length === 0 ? (
          <EmptyState
            title="No staff rows"
            description="Access is coming from PLATFORM_ADMIN_EMAILS alone. That works, but promoting somebody here means they keep access if the environment changes."
          />
        ) : (
          <div className="space-y-2">
            {staff.data.staff.map((person) => (
              <Card key={person.id}>
                <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {person.profile?.displayName ?? person.email}
                    </p>
                    <p className="text-xs text-brand-black/60">
                      {ROLE_LABELS[person.platformRole]}
                    </p>
                  </div>
                  {staff.data.canGrantRoles && (
                    <select
                      className="rounded-md border border-brand-black/20 px-2 py-1 text-sm"
                      value={person.platformRole}
                      onChange={(e) =>
                        setRole.mutate({
                          userId: person.id,
                          role: e.target.value as PlatformRole,
                        })
                      }
                    >
                      {Object.values(PlatformRole).map((role) => (
                        <option key={role} value={role}>
                          {role}
                        </option>
                      ))}
                    </select>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
        {setRole.error && (
          <p className="text-sm text-brand-red">{setRole.error.message}</p>
        )}
      </Section>

      {staff.data.canGrantRoles && (
        <Section
          title="Appoint somebody"
          description="Search by their exact sign-in address — an exact match only, so this control cannot be used to browse the membership."
        >
          <div className="flex flex-wrap gap-2">
            <input
              className="min-w-64 flex-1 rounded-md border border-brand-black/20 px-3 py-2 text-sm"
              value={lookup}
              type="email"
              placeholder="them@example.com"
              onChange={(e) => setLookup(e.target.value)}
            />
            <Button
              variant="outline"
              disabled={lookup.trim().length < 3}
              onClick={() => setQuery(lookup.trim())}
            >
              Find
            </Button>
          </div>

          {query && staff.data.matches.length === 0 && (
            <p className="text-sm text-brand-black/60">
              No account with that address. They have to sign up first.
            </p>
          )}

          {staff.data.matches.map((person) => (
            <Card key={person.id}>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {person.profile?.displayName ?? person.email}
                  </p>
                  <p className="text-xs text-brand-black/60">
                    {person.email} · {ROLE_LABELS[person.platformRole]}
                  </p>
                </div>
                <select
                  className="rounded-md border border-brand-black/20 px-2 py-1 text-sm"
                  value={person.platformRole}
                  onChange={(e) =>
                    setRole.mutate({
                      userId: person.id,
                      role: e.target.value as PlatformRole,
                    })
                  }
                >
                  {Object.values(PlatformRole).map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
              </CardContent>
            </Card>
          ))}
        </Section>
      )}
    </div>
  );
}
