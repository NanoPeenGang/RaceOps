"use client";

import { useState } from "react";
import Link from "next/link";
import { ApplicationStatus } from "@prisma/client";
import { api } from "@/lib/trpc/client";
import { STATUS_LABELS } from "@/lib/applications";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function MyPostingsPage() {
  const postings = api.opportunity.myPostings.useQuery();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold">My postings</h1>
        <Link href="/opportunities/new">
          <Button variant="primary">Post an opportunity</Button>
        </Link>
      </div>
      {postings.isLoading && <p className="text-brand-black/60">Loading…</p>}
      {postings.data?.length === 0 && (
        <p className="text-brand-black/60">
          You haven&apos;t posted any opportunities yet.
        </p>
      )}
      <div className="space-y-4">
        {postings.data?.map((posting) => (
          <PostingCard key={posting.id} posting={posting} />
        ))}
      </div>
    </div>
  );
}

function PostingCard({
  posting,
}: {
  posting: {
    id: string;
    title: string;
    status: string;
    postedByTeam: { name: string } | null;
    _count: { applications: number };
  };
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>{posting.title}</CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant={posting.status === "OPEN" ? "verified" : "default"}>
              {posting.status.toLowerCase()}
            </Badge>
            {posting.postedByTeam && <Badge>{posting.postedByTeam.name}</Badge>}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <button
          className="text-sm font-medium text-brand-red hover:underline"
          onClick={() => setExpanded((v) => !v)}
        >
          {posting._count.applications} application
          {posting._count.applications === 1 ? "" : "s"}{" "}
          {expanded ? "▴" : "▾"}
        </button>
        {expanded && <ApplicationList opportunityId={posting.id} />}
      </CardContent>
    </Card>
  );
}

function ApplicationList({ opportunityId }: { opportunityId: string }) {
  const utils = api.useUtils();
  const applications = api.opportunity.applicationsFor.useQuery({ opportunityId });
  const setStatus = api.opportunity.setApplicationStatus.useMutation({
    onSuccess: () => utils.opportunity.applicationsFor.invalidate({ opportunityId }),
  });

  if (applications.isLoading) {
    return <p className="text-sm text-brand-black/60">Loading applications…</p>;
  }
  if (!applications.data?.length) {
    return <p className="text-sm text-brand-black/60">No applications yet.</p>;
  }
  return (
    <ul className="space-y-3">
      {applications.data.map((application) => (
        <li
          key={application.id}
          className="rounded-lg border border-brand-black/10 p-3"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">
                {application.applicant.profile?.displayName ?? "Unnamed"}
              </p>
              <p className="text-xs text-brand-black/60">
                {application.applicant.profile?.location}
              </p>
            </div>
            <Badge>{STATUS_LABELS[application.status]}</Badge>
          </div>
          {application.coverNote && (
            <p className="mt-2 whitespace-pre-wrap text-sm text-brand-black/80">
              {application.coverNote}
            </p>
          )}
          {[ApplicationStatus.SUBMITTED, ApplicationStatus.REVIEWING].includes(
            application.status as never,
          ) && (
            <div className="mt-3 flex flex-wrap gap-2">
              {application.status === ApplicationStatus.SUBMITTED && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={setStatus.isPending}
                  onClick={() =>
                    setStatus.mutate({
                      applicationId: application.id,
                      status: ApplicationStatus.REVIEWING,
                    })
                  }
                >
                  Start review
                </Button>
              )}
              <Button
                size="sm"
                variant="primary"
                disabled={setStatus.isPending}
                onClick={() =>
                  setStatus.mutate({
                    applicationId: application.id,
                    status: ApplicationStatus.ACCEPTED,
                  })
                }
              >
                Accept
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={setStatus.isPending}
                onClick={() =>
                  setStatus.mutate({
                    applicationId: application.id,
                    status: ApplicationStatus.REJECTED,
                  })
                }
              >
                Reject
              </Button>
            </div>
          )}
          {setStatus.error && (
            <p className="mt-1 text-xs text-brand-red">
              {setStatus.error.message}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
