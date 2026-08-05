import { ApplicationStatus } from "@prisma/client";

/**
 * The hiring pipeline: where an application is, and where it can go next.
 *
 * Replaces the flat status list `applications.ts` held with a stage machine,
 * because "streamline the posting so teams get applications in an inbox" is
 * really a request for a pipeline — a thing with an order, so a team can see
 * at a glance who is waiting on them.
 *
 * Two routes reach ACCEPTED and both are legitimate. A team can say yes
 * outright — most club hiring is a conversation and a handshake — or it can
 * run interviews and a formal offer and let the applicant answer. Forcing
 * every team through the paperwork would make this something people work
 * around, and a feature people work around records nothing.
 */

export const APPLICATION_STATUS_LABELS: Record<ApplicationStatus, string> = {
  SUBMITTED: "New",
  REVIEWING: "In review",
  INTERVIEWING: "Interviewing",
  OFFERED: "Offer out",
  ACCEPTED: "Hired",
  REJECTED: "Not taken forward",
  WITHDRAWN: "Withdrawn",
  OFFER_DECLINED: "Offer declined",
};

export const APPLICATION_STATUS_DESCRIPTIONS: Record<
  ApplicationStatus,
  string
> = {
  SUBMITTED: "Nobody has looked at this yet.",
  REVIEWING: "Being read. The applicant can see that it is.",
  INTERVIEWING: "A time is proposed or booked.",
  OFFERED: "An offer is out and unanswered.",
  ACCEPTED: "On the roster.",
  REJECTED: "The team said no.",
  WITHDRAWN: "The applicant pulled out.",
  OFFER_DECLINED: "The applicant turned the offer down.",
};

/**
 * Pipeline order — left to right on the board.
 *
 * Only the live stages. The four ways an application ends are not columns: a
 * board where three of seven columns are closed cases is a board nobody can
 * read, and the closed ones are looked at deliberately rather than scanned.
 */
export const PIPELINE_STAGES: readonly ApplicationStatus[] = [
  ApplicationStatus.SUBMITTED,
  ApplicationStatus.REVIEWING,
  ApplicationStatus.INTERVIEWING,
  ApplicationStatus.OFFERED,
];

/** An application nobody needs to act on again. */
export const CLOSED_STATUSES: readonly ApplicationStatus[] = [
  ApplicationStatus.ACCEPTED,
  ApplicationStatus.REJECTED,
  ApplicationStatus.WITHDRAWN,
  ApplicationStatus.OFFER_DECLINED,
];

export function isClosed(status: ApplicationStatus): boolean {
  return CLOSED_STATUSES.includes(status);
}

/**
 * Statuses a team may set directly.
 *
 * ACCEPTED is here, deliberately, alongside the offer flow. A team that just
 * wants to say yes should be able to; the offer exists for teams that want the
 * terms on the record, not as a toll gate.
 *
 * OFFER_DECLINED is *not* here: only the applicant can decline an offer, and a
 * team marking it themselves would be writing somebody else's answer down.
 */
export const TEAM_SETTABLE_STATUSES: readonly ApplicationStatus[] = [
  ApplicationStatus.REVIEWING,
  ApplicationStatus.INTERVIEWING,
  ApplicationStatus.OFFERED,
  ApplicationStatus.ACCEPTED,
  ApplicationStatus.REJECTED,
];

/**
 * Whether a team may move an application from one status to another.
 *
 * Closed stays closed. Reopening a rejected application by moving it back into
 * review would quietly rewrite a decision the applicant has already been told
 * about; the honest move is a fresh application.
 */
export function canTeamTransition(
  from: ApplicationStatus,
  to: ApplicationStatus,
): boolean {
  if (from === to) return false;
  if (isClosed(from)) return false;
  return TEAM_SETTABLE_STATUSES.includes(to);
}

/** Whether the applicant may withdraw. Not once anything is settled. */
export function canApplicantWithdraw(from: ApplicationStatus): boolean {
  return !isClosed(from);
}

export interface PipelineApplication {
  status: ApplicationStatus;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface StageBucket<T> {
  status: ApplicationStatus;
  applications: T[];
}

/**
 * Sorts applications into pipeline columns, oldest first inside each.
 *
 * Oldest first is the point: the person who has been waiting longest is the
 * one the team owes an answer, and a newest-first inbox buries them under
 * every arrival since.
 */
export function buildPipeline<T extends PipelineApplication>(
  applications: readonly T[],
): StageBucket<T>[] {
  return PIPELINE_STAGES.map((status) => ({
    status,
    applications: applications
      .filter((application) => application.status === status)
      .sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      ),
  }));
}

/**
 * How long an application has been sitting, in days.
 *
 * Measured from `createdAt`, not `updatedAt`. Nudging somebody from "new" to
 * "in review" without answering them is not progress, and resetting the clock
 * for it would hide exactly the applications this number exists to surface.
 */
export function daysWaiting(
  application: PipelineApplication,
  now: Date = new Date(),
): number {
  return Math.floor(
    (now.getTime() - new Date(application.createdAt).getTime()) / 86_400_000,
  );
}

/**
 * After this many days with no answer, an application is flagged as stale.
 *
 * A week. Long enough that a team with a race weekend in between is not
 * scolded, short enough that it still means something — the actual failure
 * this addresses is applications nobody ever replies to at all.
 */
export const STALE_AFTER_DAYS = 7;

export function isStale(
  application: PipelineApplication,
  now: Date = new Date(),
): boolean {
  if (isClosed(application.status)) return false;
  return daysWaiting(application, now) >= STALE_AFTER_DAYS;
}

export interface InboxCounts {
  /** Not yet looked at. The number that belongs on a badge. */
  unread: number;
  /** Everywhere in the live pipeline. */
  open: number;
  /** Open and older than the stale threshold. */
  waiting: number;
  hired: number;
}

export function inboxCounts<T extends PipelineApplication>(
  applications: readonly T[],
  now: Date = new Date(),
): InboxCounts {
  return {
    unread: applications.filter(
      (application) => application.status === ApplicationStatus.SUBMITTED,
    ).length,
    open: applications.filter((application) => !isClosed(application.status))
      .length,
    waiting: applications.filter((application) => isStale(application, now))
      .length,
    hired: applications.filter(
      (application) => application.status === ApplicationStatus.ACCEPTED,
    ).length,
  };
}
