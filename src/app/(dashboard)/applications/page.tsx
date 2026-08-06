"use client";

import { useState } from "react";
import Link from "next/link";
import { InterviewStatus, OfferStatus } from "@prisma/client";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/trpc/root";
import { api } from "@/lib/trpc/client";
import {
  APPLICATION_STATUS_LABELS,
  APPLICATION_STATUS_DESCRIPTIONS,
  canApplicantWithdraw,
} from "@/lib/hiring";
import {
  INTERVIEW_KIND_LABELS,
  INTERVIEW_STATUS_LABELS,
  chosenSlot,
  formatDuration,
  formatSlot,
} from "@/lib/interviews";
import { PAY_BASIS_LABELS, describeExpiry, describePay } from "@/lib/offers";
import { TEAM_ROLE_LABELS } from "@/lib/teams";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, PageHeader } from "@/components/ui/page";

/**
 * The applicant's side of hiring.
 *
 * Everything that is waiting on *them* comes first and is a button: pick an
 * interview time, answer an offer. The rest is status. A page where the thing
 * you have to do is three scrolls below a list of applications you sent in
 * January is a page that costs somebody a seat.
 */

type MyApplications =
  inferRouterOutputs<AppRouter>["hiring"]["myApplications"]["applications"];
type MyApplication = MyApplications[number];

export default function MyApplicationsPage() {
  const utils = api.useUtils();
  const data = api.hiring.myApplications.useQuery();
  const withdraw = api.opportunity.withdrawApplication.useMutation({
    onSuccess: () => utils.hiring.myApplications.invalidate(),
  });

  const refresh = () => utils.hiring.myApplications.invalidate();
  const applications = data.data?.applications ?? [];

  const needsYou = applications.filter(
    (application) =>
      application.interviews.some(
        (interview) => interview.status === InterviewStatus.PROPOSED,
      ) ||
      application.offers.some((offer) => offer.status === OfferStatus.SENT),
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="My applications"
        description="Where every application has got to, and anything waiting on you."
      />

      {data.isLoading && <p className="text-brand-black/60">Loading…</p>}

      {!data.isLoading && applications.length === 0 && (
        <EmptyState
          title="Nothing applied for yet"
          description="Seats and crew jobs are posted by teams looking for people."
          action={
            <Link href="/opportunities">
              <Button variant="primary">Browse opportunities</Button>
            </Link>
          }
        />
      )}

      {needsYou.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Waiting on you</h2>
          {needsYou.map((application) => (
            <ActionCard
              key={application.id}
              application={application}
              onChanged={refresh}
            />
          ))}
        </section>
      )}

      {applications.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Everything</h2>
          {applications.map((application) => (
            <Card key={application.id}>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle>{application.opportunity.title}</CardTitle>
                  <Badge
                    variant={
                      application.status === "ACCEPTED" ? "verified" : "default"
                    }
                  >
                    {APPLICATION_STATUS_LABELS[application.status]}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-sm text-brand-black/60">
                  {APPLICATION_STATUS_DESCRIPTIONS[application.status]}
                </p>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-brand-black/60">
                    {[
                      application.opportunity.postedByTeam?.name,
                      `applied ${new Date(application.createdAt).toLocaleDateString()}`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  {canApplicantWithdraw(application.status) && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={withdraw.isPending}
                      onClick={() =>
                        withdraw.mutate({ applicationId: application.id })
                      }
                    >
                      Withdraw
                    </Button>
                  )}
                </div>
                {withdraw.error && (
                  <p className="text-sm text-brand-red">
                    {withdraw.error.message}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </section>
      )}
    </div>
  );
}

function ActionCard({
  application,
  onChanged,
}: {
  application: MyApplication;
  onChanged: () => void;
}) {
  const proposed = application.interviews.filter(
    (interview) => interview.status === InterviewStatus.PROPOSED,
  );
  const live = application.offers.filter(
    (offer) => offer.status === OfferStatus.SENT,
  );

  return (
    <Card className="border-brand-red/40">
      <CardContent className="space-y-4 p-5">
        <div>
          <p className="font-semibold">{application.opportunity.title}</p>
          <p className="text-sm text-brand-black/60">
            {application.opportunity.postedByTeam?.name}
          </p>
        </div>

        {proposed.map((interview) => (
          <InterviewInvite
            key={interview.id}
            interview={interview}
            onChanged={onChanged}
          />
        ))}

        {live.map((offer) => (
          <OfferCard key={offer.id} offer={offer} onChanged={onChanged} />
        ))}
      </CardContent>
    </Card>
  );
}

type Interview = MyApplication["interviews"][number];

function InterviewInvite({
  interview,
  onChanged,
}: {
  interview: Interview;
  onChanged: () => void;
}) {
  const [note, setNote] = useState("");
  const respond = api.hiring.respondToInterview.useMutation({
    onSuccess: onChanged,
  });
  const booked = chosenSlot(interview.slots);

  return (
    <div className="space-y-2 rounded-lg bg-brand-black/[0.03] p-4">
      <p className="text-sm font-medium">
        {INTERVIEW_KIND_LABELS[interview.kind]} ·{" "}
        {formatDuration(interview.durationMinutes)}
      </p>
      {interview.agenda && (
        <p className="whitespace-pre-wrap text-sm text-brand-black/75">
          {interview.agenda}
        </p>
      )}
      {interview.location && (
        <p className="text-xs text-brand-black/55">{interview.location}</p>
      )}

      {booked ? (
        <p className="text-sm">
          <Badge variant="verified">
            {INTERVIEW_STATUS_LABELS[interview.status]}
          </Badge>{" "}
          {formatSlot(booked.startsAt)}
        </p>
      ) : (
        <>
          <p className="text-xs text-brand-black/55">
            Pick whichever works — times are shown in your own zone.
          </p>
          <div className="flex flex-wrap gap-2">
            {interview.slots.map((slot) => (
              <Button
                key={slot.id}
                size="sm"
                variant="primary"
                disabled={respond.isPending}
                onClick={() =>
                  respond.mutate({
                    interviewId: interview.id,
                    slotId: slot.id,
                    note: note.trim() || null,
                  })
                }
              >
                {formatSlot(slot.startsAt)}
              </Button>
            ))}
            <Button
              size="sm"
              variant="ghost"
              disabled={respond.isPending}
              onClick={() =>
                respond.mutate({
                  interviewId: interview.id,
                  slotId: null,
                  note: note.trim() || null,
                })
              }
            >
              None of these work
            </Button>
          </div>
          {/* Worth most when declining: saying why turns a dead end into
              three new times. */}
          <input
            className="w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Anything to add? e.g. after 6pm is easier, or I'm racing that weekend"
            maxLength={1000}
          />
        </>
      )}
      {respond.error && (
        <p className="text-sm text-brand-red">{respond.error.message}</p>
      )}
    </div>
  );
}

type Offer = MyApplication["offers"][number];

function OfferCard({
  offer,
  onChanged,
}: {
  offer: Offer;
  onChanged: () => void;
}) {
  const [note, setNote] = useState("");
  const respond = api.hiring.respondToOffer.useMutation({
    onSuccess: onChanged,
  });
  const expiry = describeExpiry(offer.expiresAt);

  return (
    <div className="space-y-3 rounded-lg border border-brand-red/30 bg-brand-red/[0.03] p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-semibold">
          Offer: {TEAM_ROLE_LABELS[offer.role]}
          {offer.title && (
            <span className="ml-2 font-normal text-brand-black/70">
              {offer.title}
            </span>
          )}
        </p>
        {expiry && <span className="text-xs text-brand-black/60">{expiry}</span>}
      </div>

      <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        <Term label="Pay">{describePay(offer)}</Term>
        <Term label="Basis">{PAY_BASIS_LABELS[offer.basis]}</Term>
        {offer.scope && <Term label="Covers">{offer.scope}</Term>}
        {offer.startDate && (
          <Term label="Starts">
            {new Date(offer.startDate).toLocaleDateString()}
          </Term>
        )}
      </dl>

      {offer.extras && (
        <p className="whitespace-pre-wrap text-sm text-brand-black/75">
          {offer.extras}
        </p>
      )}
      {offer.terms && (
        <p className="whitespace-pre-wrap text-sm text-brand-black/75">
          {offer.terms}
        </p>
      )}

      <p className="text-xs text-brand-black/55">
        Accepting puts you on the team&rsquo;s roster as{" "}
        {TEAM_ROLE_LABELS[offer.role].toLowerCase()}.
      </p>

      <textarea
        rows={2}
        className="w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="Anything you want to say with your answer (optional)"
      />

      {respond.error && (
        <p className="text-sm text-brand-red">{respond.error.message}</p>
      )}
      <div className="flex gap-2">
        <Button
          variant="primary"
          disabled={respond.isPending}
          onClick={() =>
            respond.mutate({
              offerId: offer.id,
              accept: true,
              note: note.trim() || null,
            })
          }
        >
          {respond.isPending ? "Sending…" : "Accept"}
        </Button>
        <Button
          variant="outline"
          disabled={respond.isPending}
          onClick={() =>
            respond.mutate({
              offerId: offer.id,
              accept: false,
              note: note.trim() || null,
            })
          }
        >
          Decline
        </Button>
      </div>
    </div>
  );
}

function Term({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-brand-black/50">
        {label}
      </dt>
      <dd className="text-brand-black/80">{children}</dd>
    </div>
  );
}
