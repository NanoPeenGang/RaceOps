import { AccessRequestKind, AccessRequestStatus } from "@prisma/client";

/**
 * Applications to publish something on the platform.
 *
 * The line this feature draws: **anyone can sign up, keep a profile, drive,
 * crew, apply for seats and message people.** What needs approving is
 * publishing — a team, an organization, a championship or a sponsor account.
 * Those are the four surfaces spam actually uses, and each puts a name in
 * front of everybody else.
 *
 * Drawing it anywhere wider would be worse than the spam. A platform where a
 * driver cannot make a profile until a human approves them is a platform
 * nobody joins, and the review queue would fill with people who just want to
 * enter a race.
 */

export const ACCESS_KIND_LABELS: Record<AccessRequestKind, string> = {
  TEAM: "Race team",
  ORGANIZATION: "Organization",
  SERIES: "Championship",
  SPONSOR: "Sponsor account",
  RECRUITING: "Hiring & seat adverts",
};

export const ACCESS_KIND_DESCRIPTIONS: Record<AccessRequestKind, string> = {
  TEAM: "A team page with a roster, a garage, entries and hiring.",
  ORGANIZATION: "A club or promoter that runs several series or teams.",
  SERIES: "A championship with a calendar, entries and standings.",
  SPONSOR:
    "Pitch sponsorship to teams directly and track your deals in one place.",
  RECRUITING:
    "Advertise race seats, crew jobs and volunteer shifts on behalf of a team or organization.",
};

/**
 * What a reviewer is actually being asked to judge, per kind.
 *
 * Shown on the form and on the review queue, so an applicant knows what to
 * write and a reviewer knows what they are weighing. A queue with no stated
 * bar gets decided on vibes and then inconsistently.
 */
export const ACCESS_KIND_CRITERIA: Record<AccessRequestKind, string> = {
  TEAM: "Is this a real team that races, or intends to? A club team with two people and one car is exactly who this is for.",
  ORGANIZATION:
    "Does this body actually run events or teams? An organization is for people with several things to administer, not a solo entry.",
  SERIES:
    "Is there a real championship behind this — a calendar, regulations, somebody to run it? A series page nobody organizes is a dead end for entrants.",
  SPONSOR:
    "Is there a real business here? A sponsor account can message every team on the platform, which is exactly what spam wants.",
  RECRUITING:
    "Is this a real outfit with something real to offer? A seat advert reaches every driver on the platform, and a fake one wastes the time of people who applied to it in good faith.",
};

export const ACCESS_STATUS_LABELS: Record<AccessRequestStatus, string> = {
  PENDING: "Waiting on review",
  APPROVED: "Approved",
  REJECTED: "Declined",
  WITHDRAWN: "Withdrawn",
};

/**
 * Kinds granted to a team or organization rather than to the person asking.
 *
 * The distinction that matters for recruiting: a manager who applies and then
 * leaves must not take the team's ability to hire with them, and being
 * approved for one team is not a licence to post on behalf of another.
 */
export const SUBJECT_KINDS: readonly AccessRequestKind[] = [
  AccessRequestKind.RECRUITING,
];

export function needsSubject(kind: AccessRequestKind): boolean {
  return SUBJECT_KINDS.includes(kind);
}

/** Kinds that produce a thing; SPONSOR and RECRUITING are standing grants. */
export const CREATING_KINDS: readonly AccessRequestKind[] = [
  AccessRequestKind.TEAM,
  AccessRequestKind.ORGANIZATION,
  AccessRequestKind.SERIES,
];

export function createsAnEntity(kind: AccessRequestKind): boolean {
  return CREATING_KINDS.includes(kind);
}

export interface RequestRecord {
  kind: AccessRequestKind;
  status: AccessRequestStatus;
  fulfilledEntityId?: string | null;
}

/**
 * Whether an approved request can still be spent on a creation.
 *
 * An approval is consumed by one creation, not a standing licence. Somebody
 * approved for a team gets *a* team — a second one is a second application.
 * Without this, one approval is a spam licence with extra steps.
 */
export function isSpendable(request: RequestRecord): boolean {
  if (request.status !== AccessRequestStatus.APPROVED) return false;
  if (!createsAnEntity(request.kind)) return false;
  return !request.fulfilledEntityId;
}

/**
 * Whether an approval lets a team advertise.
 *
 * Never spent, like sponsor access: a team that hires once will hire again,
 * and consuming the approval on the first advert would mean re-applying every
 * time somebody leaves.
 */
export function grantsRecruitingAccess(request: RequestRecord): boolean {
  return (
    request.kind === AccessRequestKind.RECRUITING &&
    request.status === AccessRequestStatus.APPROVED
  );
}

/** Whether an approval grants standing sponsor access. */
export function grantsSponsorAccess(request: RequestRecord): boolean {
  return (
    request.kind === AccessRequestKind.SPONSOR &&
    request.status === AccessRequestStatus.APPROVED
  );
}

/** A request the applicant can still pull. */
export function canWithdraw(status: AccessRequestStatus): boolean {
  return status === AccessRequestStatus.PENDING;
}

/** A request a reviewer can still decide. */
export function canDecide(status: AccessRequestStatus): boolean {
  return status === AccessRequestStatus.PENDING;
}

/**
 * Whether somebody may apply again for this kind.
 *
 * Blocked only while one is pending — a second open application for the same
 * thing is queue noise. A rejection does not bar re-applying: people fix what
 * was wrong and come back, and a permanent bar would need an appeals process
 * nobody has asked for.
 */
export function canApplyFor(
  kind: AccessRequestKind,
  existing: readonly RequestRecord[],
): boolean {
  return !existing.some(
    (request) =>
      request.kind === kind && request.status === AccessRequestStatus.PENDING,
  );
}

export type RequestProblem =
  | { field: "proposedName"; message: string }
  | { field: "summary"; message: string };

/**
 * Whether an application is worth a reviewer's time.
 *
 * Deliberately light. The bar is "somebody wrote something", not a quality
 * judgement — that is the reviewer's job, and a form that argues with people
 * before a human has looked is how you lose the applicants you wanted.
 */
export function checkRequest(input: {
  proposedName: string;
  summary: string;
}): RequestProblem | null {
  if (input.proposedName.trim().length < 2) {
    return { field: "proposedName", message: "Give it a name." };
  }
  if (input.summary.trim().length < 20) {
    return {
      field: "summary",
      message:
        "Say a bit more about what this is — a couple of sentences is enough, and it is the main thing a reviewer reads.",
    };
  }
  return null;
}

export interface QueueRequest {
  status: AccessRequestStatus;
  createdAt: Date | string;
}

/** How long an application has been waiting, in days. */
export function daysPending(
  request: QueueRequest,
  now: Date = new Date(),
): number {
  return Math.floor(
    (now.getTime() - new Date(request.createdAt).getTime()) / 86_400_000,
  );
}

/**
 * How long is too long to leave somebody waiting.
 *
 * Three days. Shorter than the hiring threshold on purpose: an unanswered
 * application here blocks somebody from using the platform at all, where an
 * unanswered job application only blocks one conversation.
 */
export const REVIEW_SLA_DAYS = 3;

export function isOverdue(
  request: QueueRequest,
  now: Date = new Date(),
): boolean {
  if (request.status !== AccessRequestStatus.PENDING) return false;
  return daysPending(request, now) >= REVIEW_SLA_DAYS;
}

/** Pending first, oldest first inside that — whoever has waited longest. */
export function sortQueue<T extends QueueRequest>(requests: readonly T[]): T[] {
  return [...requests].sort((a, b) => {
    const pendingA = a.status === AccessRequestStatus.PENDING;
    const pendingB = b.status === AccessRequestStatus.PENDING;
    if (pendingA !== pendingB) return pendingA ? -1 : 1;
    return (
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
  });
}
