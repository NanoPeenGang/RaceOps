"use client";

import { useState } from "react";
import { AccessRequestKind, AccessRequestStatus } from "@prisma/client";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/trpc/root";
import { api } from "@/lib/trpc/client";
import {
  ACCESS_KIND_CRITERIA,
  ACCESS_KIND_DESCRIPTIONS,
  ACCESS_KIND_LABELS,
  ACCESS_STATUS_LABELS,
  createsAnEntity,
  daysPending,
  REVIEW_SLA_DAYS,
} from "@/lib/access-requests";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState, PageHeader, Section } from "@/components/ui/page";
import { ListSkeleton } from "@/components/ui/skeleton";

/**
 * Applying to publish something.
 *
 * The page leads with what you *don't* need to be here for. Somebody who has
 * just signed up and wants to drive should be able to read the first sentence
 * and leave — otherwise the queue fills with people who only wanted to enter a
 * race, and the applications that matter wait behind them.
 */

const KINDS = Object.values(AccessRequestKind);

export default function ApplyPage() {
  const mine = api.access.mine.useQuery();
  const [kind, setKind] = useState<AccessRequestKind | null>(null);

  const requests = mine.data?.requests ?? [];

  return (
    <div className="space-y-8">
      <PageHeader
        title="Apply to publish"
        description="Driving, crewing, applying for seats and messaging people need no approval — sign up and go. This page is only for the four things that put a name in front of everybody else."
      />

      {mine.isLoading && <ListSkeleton />}

      {mine.data?.isStaff && (
        <Card>
          <CardContent className="p-5">
            <p className="text-sm">
              You are platform staff, so nothing here applies to you — you can
              create teams, organizations and championships directly, and you
              review everybody else&rsquo;s applications from the queue.
            </p>
          </CardContent>
        </Card>
      )}

      {mine.data && !mine.data.isStaff && (
        <Section
          title="What you can apply for"
          description={`One application per thing at a time. We aim to come back within ${REVIEW_SLA_DAYS} days.`}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            {KINDS.map((option) => {
              const open = kind === option;
              const allowed = mine.data.canApply[option];
              return (
                <Card key={option} className="h-full">
                  <CardContent className="space-y-3 p-4">
                    <div>
                      <p className="font-medium">
                        {ACCESS_KIND_LABELS[option]}
                      </p>
                      <p className="mt-1 text-sm text-brand-black/60">
                        {ACCESS_KIND_DESCRIPTIONS[option]}
                      </p>
                    </div>
                    <p className="rounded-md bg-brand-black/[0.03] p-3 text-xs text-brand-black/70">
                      <span className="font-semibold">
                        What a reviewer looks for:{" "}
                      </span>
                      {ACCESS_KIND_CRITERIA[option]}
                    </p>
                    {createsAnEntity(option) && (
                      <p className="text-xs text-brand-black/50">
                        An approval covers one{" "}
                        {ACCESS_KIND_LABELS[option].toLowerCase()}. Apply again
                        for another.
                      </p>
                    )}
                    <Button
                      variant={open ? "outline" : "primary"}
                      disabled={!allowed}
                      onClick={() => setKind(open ? null : option)}
                    >
                      {!allowed
                        ? "Already waiting on review"
                        : open
                          ? "Cancel"
                          : "Apply"}
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </Section>
      )}

      {kind && <ApplyForm kind={kind} onDone={() => setKind(null)} />}

      <Section
        title="Your applications"
        description="Everything you have sent, and what came back."
      >
        {requests.length === 0 ? (
          <EmptyState
            title="Nothing sent yet"
            description="Applications you send appear here with the reviewer's answer."
          />
        ) : (
          <div className="space-y-3">
            {requests.map((request) => (
              <RequestRow key={request.id} request={request} />
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

function ApplyForm({
  kind,
  onDone,
}: {
  kind: AccessRequestKind;
  onDone: () => void;
}) {
  const utils = api.useUtils();
  const [proposedName, setProposedName] = useState("");
  const [summary, setSummary] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [experience, setExperience] = useState("");

  const apply = api.access.submit.useMutation({
    meta: {
      silenceError: true,
      successMessage: "Application sent. We will come back to you.",
    },
    onSuccess: async () => {
      await utils.access.mine.invalidate();
      onDone();
    },
  });

  return (
    <Card className="max-w-2xl">
      <CardContent className="space-y-4 p-5">
        <div>
          <h3 className="font-semibold">
            {ACCESS_KIND_LABELS[kind]} application
          </h3>
          <p className="mt-1 text-sm text-brand-black/60">
            {ACCESS_KIND_CRITERIA[kind]}
          </p>
        </div>

        <label className="block text-sm font-medium">
          {kind === AccessRequestKind.SPONSOR ? "Business name" : "Name"}
          <input
            className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
            value={proposedName}
            maxLength={120}
            onChange={(e) => setProposedName(e.target.value)}
          />
        </label>

        <label className="block text-sm font-medium">
          What is it?
          <textarea
            className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
            rows={4}
            maxLength={4000}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="A couple of sentences. This is the main thing a reviewer reads."
          />
        </label>

        <label className="block text-sm font-medium">
          Website or social link
          <input
            className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
            value={websiteUrl}
            onChange={(e) => setWebsiteUrl(e.target.value)}
            placeholder="https://"
          />
          <span className="mt-1 block text-xs font-normal text-brand-black/50">
            Optional, but it is the fastest way for somebody to check you are
            real.
          </span>
        </label>

        <label className="block text-sm font-medium">
          Your racing background
          <textarea
            className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
            rows={3}
            maxLength={4000}
            value={experience}
            onChange={(e) => setExperience(e.target.value)}
            placeholder="Optional. Where you race, who with, how long."
          />
        </label>

        {apply.error && (
          <p className="text-sm text-brand-red">{apply.error.message}</p>
        )}

        <div className="flex gap-2">
          <Button
            variant="primary"
            disabled={apply.isPending}
            onClick={() =>
              apply.mutate({
                kind,
                proposedName: proposedName.trim(),
                summary: summary.trim(),
                websiteUrl: websiteUrl.trim() || null,
                experience: experience.trim() || null,
              })
            }
          >
            {apply.isPending ? "Sending…" : "Send application"}
          </Button>
          <Button variant="outline" onClick={onDone}>
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

type MyRequest =
  inferRouterOutputs<AppRouter>["access"]["mine"]["requests"][number];

function RequestRow({ request }: { request: MyRequest }) {
  const utils = api.useUtils();
  const withdraw = api.access.withdraw.useMutation({
    onSuccess: () => utils.access.mine.invalidate(),
  });

  const pending = request.status === AccessRequestStatus.PENDING;
  const spent = Boolean(request.fulfilledEntityId);

  return (
    <Card>
      <CardContent className="space-y-2 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate font-medium">{request.proposedName}</p>
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
                ? `Sent ${daysPending(request)} day(s) ago`
                : request.reviewedAt
                  ? `Answered ${new Date(request.reviewedAt).toLocaleDateString()}`
                  : null}
            </p>
          </div>
          {pending && (
            <Button
              variant="outline"
              disabled={withdraw.isPending}
              onClick={() => withdraw.mutate({ requestId: request.id })}
            >
              Withdraw
            </Button>
          )}
        </div>

        {request.decisionNote && (
          <p className="rounded-md bg-brand-black/[0.03] p-3 text-sm">
            {request.decisionNote}
          </p>
        )}

        {request.status === AccessRequestStatus.APPROVED &&
          createsAnEntity(request.kind) && (
            <p className="text-sm text-brand-black/70">
              {spent
                ? "Used. Apply again if you need another."
                : `Approved — go and create your ${ACCESS_KIND_LABELS[
                    request.kind
                  ].toLowerCase()}.`}
            </p>
          )}

        {request.status === AccessRequestStatus.APPROVED &&
          request.kind === AccessRequestKind.SPONSOR && (
            <p className="text-sm text-brand-black/70">
              Approved — your sponsor console is at{" "}
              <a className="underline" href="/sponsor">
                /sponsor
              </a>
              .
            </p>
          )}
      </CardContent>
    </Card>
  );
}
