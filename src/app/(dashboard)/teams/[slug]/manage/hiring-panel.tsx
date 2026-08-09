"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ApplicationStatus,
  InterviewKind,
  InterviewStatus,
  OfferStatus,
  PayBasis,
  TeamRole,
} from "@prisma/client";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/trpc/root";
import { api } from "@/lib/trpc/client";
import { APPLICATION_STATUS_LABELS, daysWaiting, isStale } from "@/lib/hiring";
import {
  INTERVIEW_KIND_LABELS,
  INTERVIEW_STATUS_LABELS,
  LOCATION_PLACEHOLDERS,
  MAX_SLOTS,
  chosenSlot,
  formatDuration,
  formatSlot,
} from "@/lib/interviews";
import {
  OFFER_STATUS_LABELS,
  PAY_BASIS_LABELS,
  PAY_BASIS_ORDER,
  describeExpiry,
  describePay,
} from "@/lib/offers";
import { TEAM_ROLE_LABELS } from "@/lib/teams";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/**
 * The applications inbox.
 *
 * A team does not think in postings — it thinks in people waiting on an
 * answer. So this spans every opportunity the team has open, arranged as a
 * pipeline, with the person who has been waiting longest at the top of each
 * column. Newest-first would bury exactly the applications that need dealing
 * with.
 */

type Inbox = inferRouterOutputs<AppRouter>["hiring"]["inbox"];
type Application = Inbox["pipeline"][number]["applications"][number];

export function HiringPanel({ teamId }: { teamId: string }) {
  const utils = api.useUtils();
  const inbox = api.hiring.inbox.useQuery({ teamId }, { retry: false });
  const [openId, setOpenId] = useState<string | null>(null);
  const [showClosed, setShowClosed] = useState(false);

  const refresh = () => utils.hiring.inbox.invalidate({ teamId });

  if (inbox.error) {
    return (
      <section className="space-y-2">
        <h2 className="text-xl font-semibold">Applications</h2>
        <p className="text-sm text-brand-black/60">{inbox.error.message}</p>
      </section>
    );
  }
  if (inbox.isLoading) {
    return <p className="text-sm text-brand-black/60">Loading applications…</p>;
  }

  const data = inbox.data!;
  const open = [
    ...data.pipeline.flatMap((stage) => stage.applications),
    ...data.closed,
  ].find((application) => application.id === openId);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-xl font-semibold">Applications</h2>
          <p className="text-sm text-brand-black/60">
            Everybody who has applied to any of your postings, and what they are
            waiting on.
          </p>
        </div>
        <Link href="/opportunities/new">
          <Button size="sm" variant="outline">
            Post a seat or job
          </Button>
        </Link>
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <Stat label="New" value={data.counts.unread} tone="red" />
        <Stat label="Open" value={data.counts.open} />
        <Stat
          label="Waiting over a week"
          value={data.counts.waiting}
          tone={data.counts.waiting > 0 ? "amber" : undefined}
        />
        <Stat label="Hired" value={data.counts.hired} />
      </div>

      {data.postings.length === 0 && (
        <p className="rounded-lg border border-dashed border-brand-black/20 p-6 text-center text-sm text-brand-black/55">
          No postings yet. Advertise a seat or a crew job and the applications
          land here rather than in somebody&rsquo;s email.
        </p>
      )}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {data.pipeline.map((stage) => (
          <div key={stage.status} className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-brand-black/50">
              {APPLICATION_STATUS_LABELS[stage.status]}
              <span className="ml-2 font-normal">
                {stage.applications.length}
              </span>
            </h3>
            {stage.applications.length === 0 && (
              <p className="rounded-lg border border-dashed border-brand-black/15 p-3 text-center text-xs text-brand-black/40">
                Nothing here
              </p>
            )}
            {stage.applications.map((application) => (
              <ApplicantCard
                key={application.id}
                application={application}
                selected={openId === application.id}
                onOpen={() =>
                  setOpenId((current) =>
                    current === application.id ? null : application.id,
                  )
                }
              />
            ))}
          </div>
        ))}
      </div>

      {open && <ApplicationDetail application={open} onChanged={refresh} />}

      {data.closed.length > 0 && (
        <div>
          <button
            type="button"
            className="text-sm text-brand-black/60 hover:text-brand-black hover:underline"
            onClick={() => setShowClosed((value) => !value)}
          >
            {showClosed ? "Hide" : "Show"} closed ({data.closed.length})
          </button>
          {showClosed && (
            <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {data.closed.map((application) => (
                <ApplicantCard
                  key={application.id}
                  application={application}
                  selected={openId === application.id}
                  onOpen={() =>
                    setOpenId((current) =>
                      current === application.id ? null : application.id,
                    )
                  }
                />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "red" | "amber";
}) {
  const colour =
    tone === "red" && value > 0
      ? "text-brand-red"
      : tone === "amber" && value > 0
        ? "text-amber-600"
        : "text-brand-black/70";
  return (
    <span>
      <span className={`text-lg font-semibold tabular-nums ${colour}`}>
        {value}
      </span>{" "}
      <span className="text-brand-black/55">{label}</span>
    </span>
  );
}

function ApplicantCard({
  application,
  selected,
  onOpen,
}: {
  application: Application;
  selected: boolean;
  onOpen: () => void;
}) {
  const waiting = daysWaiting(application);
  const stale = isStale(application);

  return (
    <button
      type="button"
      onClick={onOpen}
      className={`w-full rounded-lg border p-3 text-left transition-colors ${
        selected
          ? "border-brand-red bg-brand-red/[0.04]"
          : "border-brand-black/10 hover:bg-brand-black/[0.03]"
      }`}
    >
      <p className="text-sm font-medium">
        {application.applicant.profile?.displayName ?? "Unnamed"}
      </p>
      <p className="truncate text-xs text-brand-black/60">
        {application.opportunity.title}
      </p>
      <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-brand-black/50">
        <span className={stale ? "font-medium text-amber-600" : ""}>
          {waiting === 0 ? "today" : `${waiting}d`}
        </span>
        {application.interviews.length > 0 && (
          <span>{application.interviews.length} interview</span>
        )}
        {application.offers.length > 0 && <span>offer</span>}
      </p>
    </button>
  );
}

/** Everything about one applicant, and every action a manager can take. */
function ApplicationDetail({
  application,
  onChanged,
}: {
  application: Application;
  onChanged: () => void;
}) {
  const [scheduling, setScheduling] = useState(false);
  const [offering, setOffering] = useState(false);

  const setStatus = api.opportunity.setApplicationStatus.useMutation({
    meta: { silenceError: true, successMessage: "Applicant told." },
    onSuccess: onChanged,
  });

  const profile = application.applicant.profile;
  const liveOffer = application.offers.find(
    (offer) => offer.status === OfferStatus.SENT,
  );

  return (
    <Card className="border-brand-red/30">
      <CardContent className="space-y-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-lg font-semibold">
              {profile?.displayName ?? "Unnamed"}
            </p>
            <p className="text-sm text-brand-black/60">
              {[profile?.location, application.opportunity.title]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          <Badge variant="outline">
            {APPLICATION_STATUS_LABELS[application.status]}
          </Badge>
        </div>

        {profile?.bio && (
          <p className="whitespace-pre-wrap text-sm text-brand-black/75">
            {profile.bio}
          </p>
        )}
        {application.coverNote && (
          <div className="rounded-lg bg-brand-black/[0.03] p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-brand-black/50">
              Their note
            </p>
            <p className="whitespace-pre-wrap text-sm text-brand-black/80">
              {application.coverNote}
            </p>
          </div>
        )}

        {/* Every action a manager can take, in the order they are taken. */}
        <div className="flex flex-wrap gap-2">
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
              Mark in review
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => setScheduling((open) => !open)}
          >
            {scheduling ? "Cancel" : "Propose interview"}
          </Button>
          <Button
            size="sm"
            variant="primary"
            onClick={() => setOffering((open) => !open)}
          >
            {offering ? "Cancel" : "Make an offer"}
          </Button>
          {application.status !== ApplicationStatus.REJECTED &&
            application.status !== ApplicationStatus.ACCEPTED && (
              <Button
                size="sm"
                variant="ghost"
                disabled={setStatus.isPending}
                onClick={() =>
                  setStatus.mutate({
                    applicationId: application.id,
                    status: ApplicationStatus.REJECTED,
                  })
                }
              >
                Not taking forward
              </Button>
            )}
        </div>
        {setStatus.error && (
          <p className="text-sm text-brand-red">{setStatus.error.message}</p>
        )}

        {scheduling && (
          <InterviewForm
            applicationId={application.id}
            onSaved={() => {
              setScheduling(false);
              onChanged();
            }}
          />
        )}

        {offering && (
          <OfferForm
            applicationId={application.id}
            onSaved={() => {
              setOffering(false);
              onChanged();
            }}
          />
        )}

        {application.interviews.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-brand-black/50">
              Interviews
            </h4>
            {application.interviews.map((interview) => (
              <InterviewRow
                key={interview.id}
                interview={interview}
                onChanged={onChanged}
              />
            ))}
          </div>
        )}

        {application.offers.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-brand-black/50">
              Offers
            </h4>
            {application.offers.map((offer) => (
              <OfferRow key={offer.id} offer={offer} onChanged={onChanged} />
            ))}
          </div>
        )}

        {liveOffer && (
          <p className="text-xs text-brand-black/50">
            {describeExpiry(liveOffer.expiresAt) ??
              "No expiry set — this offer stays open until answered or withdrawn."}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

type Interview = Application["interviews"][number];

function InterviewRow({
  interview,
  onChanged,
}: {
  interview: Interview;
  onChanged: () => void;
}) {
  const update = api.hiring.updateInterview.useMutation({
    onSuccess: onChanged,
  });
  const chosen = chosenSlot(interview.slots);

  return (
    <div className="rounded-lg border border-brand-black/10 p-3 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium">
          {INTERVIEW_KIND_LABELS[interview.kind]}
          <span className="ml-2 text-xs font-normal text-brand-black/50">
            {formatDuration(interview.durationMinutes)}
          </span>
        </span>
        <Badge
          variant={
            interview.status === InterviewStatus.CONFIRMED
              ? "verified"
              : "outline"
          }
        >
          {INTERVIEW_STATUS_LABELS[interview.status]}
        </Badge>
      </div>

      {chosen ? (
        <p className="text-brand-black/75">{formatSlot(chosen.startsAt)}</p>
      ) : (
        <ul className="text-xs text-brand-black/60">
          {interview.slots.map((slot) => (
            <li key={slot.id}>{formatSlot(slot.startsAt)}</li>
          ))}
        </ul>
      )}

      {interview.location && (
        <p className="text-xs text-brand-black/55">{interview.location}</p>
      )}
      {/* Most useful on a decline: "I'm at Sebring that weekend" is the
          difference between proposing three new times and writing somebody
          off as unresponsive. */}
      {interview.responseNote && (
        <p className="mt-1 whitespace-pre-wrap text-xs text-brand-black/70">
          &ldquo;{interview.responseNote}&rdquo;
        </p>
      )}
      {interview.outcome && (
        <p className="mt-1 whitespace-pre-wrap text-xs text-brand-black/70">
          {interview.outcome}
        </p>
      )}

      {(interview.status === InterviewStatus.CONFIRMED ||
        interview.status === InterviewStatus.PROPOSED) && (
        <p className="mt-1 flex gap-3 text-xs text-brand-black/50">
          <button
            type="button"
            className="hover:text-brand-black"
            disabled={update.isPending}
            onClick={() =>
              update.mutate({
                interviewId: interview.id,
                status: InterviewStatus.COMPLETED,
              })
            }
          >
            Mark done
          </button>
          <button
            type="button"
            className="hover:text-brand-red"
            disabled={update.isPending}
            onClick={() =>
              update.mutate({
                interviewId: interview.id,
                status: InterviewStatus.CANCELED,
              })
            }
          >
            Cancel
          </button>
        </p>
      )}
    </div>
  );
}

type Offer = Application["offers"][number];

function OfferRow({
  offer,
  onChanged,
}: {
  offer: Offer;
  onChanged: () => void;
}) {
  const send = api.hiring.sendOffer.useMutation({
    meta: { successMessage: "Offer sent." },
    onSuccess: onChanged,
  });
  const withdraw = api.hiring.withdrawOffer.useMutation({
    onSuccess: onChanged,
  });

  return (
    <div className="rounded-lg border border-brand-black/10 p-3 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium">
          {TEAM_ROLE_LABELS[offer.role]}
          {offer.title && (
            <span className="ml-2 font-normal text-brand-black/60">
              {offer.title}
            </span>
          )}
        </span>
        <Badge
          variant={
            offer.status === OfferStatus.ACCEPTED ? "verified" : "outline"
          }
        >
          {OFFER_STATUS_LABELS[offer.status]}
        </Badge>
      </div>
      <p className="text-brand-black/75">{describePay(offer)}</p>
      {offer.responseNote && (
        <p className="mt-1 whitespace-pre-wrap text-xs text-brand-black/60">
          &ldquo;{offer.responseNote}&rdquo;
        </p>
      )}

      <p className="mt-1 flex gap-3 text-xs text-brand-black/50">
        {offer.status === OfferStatus.DRAFT && (
          <button
            type="button"
            className="hover:text-brand-black"
            disabled={send.isPending}
            onClick={() => send.mutate({ offerId: offer.id })}
          >
            Send it
          </button>
        )}
        {(offer.status === OfferStatus.DRAFT ||
          offer.status === OfferStatus.SENT) && (
          <button
            type="button"
            className="hover:text-brand-red"
            disabled={withdraw.isPending}
            onClick={() => withdraw.mutate({ offerId: offer.id })}
          >
            Withdraw
          </button>
        )}
      </p>
      {(send.error ?? withdraw.error) && (
        <p className="text-xs text-brand-red">
          {send.error?.message ?? withdraw.error?.message}
        </p>
      )}
    </div>
  );
}

/**
 * Proposing an interview.
 *
 * Several times at once, because that is the whole feature: one suggested slot
 * becomes an email thread, three becomes one round trip.
 */
function InterviewForm({
  applicationId,
  onSaved,
}: {
  applicationId: string;
  onSaved: () => void;
}) {
  const [kind, setKind] = useState<InterviewKind>(InterviewKind.VIDEO_CALL);
  const [duration, setDuration] = useState("30");
  const [location, setLocation] = useState("");
  const [agenda, setAgenda] = useState("");
  const [slots, setSlots] = useState<string[]>([""]);

  const propose = api.hiring.proposeInterview.useMutation({
    onSuccess: onSaved,
  });

  const filled = slots.filter((slot) => slot.trim().length > 0);

  return (
    <div className="space-y-3 rounded-lg border border-brand-black/10 p-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block text-sm font-medium">
          Kind
          <select
            className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
            value={kind}
            onChange={(event) => setKind(event.target.value as InterviewKind)}
          >
            {Object.values(InterviewKind).map((option) => (
              <option key={option} value={option}>
                {INTERVIEW_KIND_LABELS[option]}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-medium">
          Minutes
          <input
            type="number"
            min={5}
            max={600}
            className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
            value={duration}
            onChange={(event) => setDuration(event.target.value)}
          />
        </label>
        <label className="block text-sm font-medium">
          Where
          <input
            className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
            value={location}
            onChange={(event) => setLocation(event.target.value)}
            placeholder={LOCATION_PLACEHOLDERS[kind]}
          />
        </label>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">
          Times to offer
          <span className="ml-2 text-xs font-normal text-brand-black/55">
            in your own time zone — they see it in theirs
          </span>
        </p>
        {slots.map((slot, index) => (
          <div key={index} className="flex gap-2">
            <input
              type="datetime-local"
              className="flex-1 rounded-md border border-brand-black/20 px-3 py-2 text-sm"
              value={slot}
              onChange={(event) =>
                setSlots((current) =>
                  current.map((value, position) =>
                    position === index ? event.target.value : value,
                  ),
                )
              }
            />
            {slots.length > 1 && (
              <button
                type="button"
                className="text-xs text-brand-black/50 hover:text-brand-red"
                onClick={() =>
                  setSlots((current) =>
                    current.filter((_, position) => position !== index),
                  )
                }
              >
                Remove
              </button>
            )}
          </div>
        ))}
        {slots.length < MAX_SLOTS && (
          <button
            type="button"
            className="text-xs text-brand-red hover:underline"
            onClick={() => setSlots((current) => [...current, ""])}
          >
            + another time
          </button>
        )}
      </div>

      <label className="block text-sm font-medium">
        What to expect{" "}
        <span className="text-brand-black/50">(they see this)</span>
        <textarea
          rows={2}
          className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
          value={agenda}
          onChange={(event) => setAgenda(event.target.value)}
          placeholder="Twenty minutes with the crew chief, then a look round the shop."
        />
      </label>

      {propose.error && (
        <p className="text-sm text-brand-red">{propose.error.message}</p>
      )}
      <Button
        size="sm"
        variant="primary"
        disabled={propose.isPending || filled.length === 0}
        onClick={() =>
          propose.mutate({
            applicationId,
            kind,
            durationMinutes: Number(duration) || 30,
            location: location.trim() || null,
            agenda: agenda.trim() || null,
            slots: filled.map((slot) => new Date(slot)),
          })
        }
      >
        {propose.isPending
          ? "Sending…"
          : `Offer ${filled.length || "no"} time${filled.length === 1 ? "" : "s"}`}
      </Button>
    </div>
  );
}

/**
 * Writing an offer.
 *
 * Unpaid is a basis, not a zero. Most club crew are volunteers and a great
 * many seats are paid by the driver, and a form that insists on a number gets
 * 0 typed into a field the payroll then treats as a wage.
 */
function OfferForm({
  applicationId,
  onSaved,
}: {
  applicationId: string;
  onSaved: () => void;
}) {
  const [role, setRole] = useState<TeamRole>(TeamRole.CREW);
  const [title, setTitle] = useState("");
  const [basis, setBasis] = useState<PayBasis>(PayBasis.PER_EVENT);
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [scope, setScope] = useState("");
  const [terms, setTerms] = useState("");
  const [expires, setExpires] = useState("");

  const create = api.hiring.createOffer.useMutation({ onSuccess: onSaved });
  const unpaid = basis === PayBasis.UNPAID;

  return (
    <div className="space-y-3 rounded-lg border border-brand-black/10 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm font-medium">
          Roster role
          <select
            className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
            value={role}
            onChange={(event) => setRole(event.target.value as TeamRole)}
          >
            {Object.values(TeamRole).map((option) => (
              <option key={option} value={option}>
                {TEAM_ROLE_LABELS[option]}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-medium">
          Title <span className="text-brand-black/50">(optional)</span>
          <input
            className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Data engineer"
          />
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block text-sm font-medium">
          Pay basis
          <select
            className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
            value={basis}
            onChange={(event) => {
              setBasis(event.target.value as PayBasis);
              if (event.target.value === PayBasis.UNPAID) setAmount("");
            }}
          >
            {PAY_BASIS_ORDER.map((option) => (
              <option key={option} value={option}>
                {PAY_BASIS_LABELS[option]}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-medium">
          Amount
          <input
            type="number"
            min={0}
            step="0.01"
            disabled={unpaid}
            className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm disabled:bg-brand-black/5"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder={unpaid ? "—" : "Leave blank to agree later"}
          />
        </label>
        <label className="block text-sm font-medium">
          Currency
          <input
            className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
            value={currency}
            maxLength={3}
            onChange={(event) => setCurrency(event.target.value.toUpperCase())}
          />
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm font-medium">
          What it covers
          <input
            className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
            value={scope}
            onChange={(event) => setScope(event.target.value)}
            placeholder="The 2026 ChampCar season, eight rounds"
          />
        </label>
        <label className="block text-sm font-medium">
          Answer by <span className="text-brand-black/50">(optional)</span>
          <input
            type="date"
            className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
            value={expires}
            onChange={(event) => setExpires(event.target.value)}
          />
        </label>
      </div>

      <label className="block text-sm font-medium">
        Terms
        <textarea
          rows={3}
          className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
          value={terms}
          onChange={(event) => setTerms(event.target.value)}
          placeholder="Travel and accommodation covered. Kit provided. Two weeks' notice either way."
        />
      </label>

      <p className="text-xs text-brand-black/55">
        Accepting puts them on the roster as{" "}
        {TEAM_ROLE_LABELS[role].toLowerCase()}
        {!unpaid && " and sets their standing pay rate"}, so nothing has to be
        retyped afterwards.
      </p>

      {create.error && (
        <p className="text-sm text-brand-red">{create.error.message}</p>
      )}
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="primary"
          disabled={create.isPending}
          onClick={() =>
            create.mutate({
              applicationId,
              role,
              title: title.trim() || null,
              basis,
              amountMinor:
                unpaid || !amount.trim()
                  ? null
                  : Math.round(Number(amount) * 100),
              currency,
              scope: scope.trim() || null,
              terms: terms.trim() || null,
              expiresAt: expires ? new Date(`${expires}T23:59:59`) : null,
              send: true,
            })
          }
        >
          {create.isPending ? "Sending…" : "Send offer"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={create.isPending}
          onClick={() =>
            create.mutate({
              applicationId,
              role,
              title: title.trim() || null,
              basis,
              amountMinor:
                unpaid || !amount.trim()
                  ? null
                  : Math.round(Number(amount) * 100),
              currency,
              scope: scope.trim() || null,
              terms: terms.trim() || null,
              expiresAt: expires ? new Date(`${expires}T23:59:59`) : null,
              send: false,
            })
          }
        >
          Save as draft
        </Button>
      </div>
    </div>
  );
}
