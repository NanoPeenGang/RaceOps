import { ApplicationStatus } from "@prisma/client";

/** Statuses a poster may set during review. */
export const POSTER_SETTABLE_STATUSES = [
  ApplicationStatus.REVIEWING,
  ApplicationStatus.ACCEPTED,
  ApplicationStatus.REJECTED,
] as const;

const TERMINAL_STATUSES: ApplicationStatus[] = [
  ApplicationStatus.ACCEPTED,
  ApplicationStatus.REJECTED,
  ApplicationStatus.WITHDRAWN,
];

/**
 * A poster can move an application forward until it reaches a terminal
 * state; applicants control WITHDRAWN themselves.
 */
export function canPosterTransition(
  from: ApplicationStatus,
  to: ApplicationStatus,
): boolean {
  if (from === to) return false;
  if (TERMINAL_STATUSES.includes(from)) return false;
  return (POSTER_SETTABLE_STATUSES as readonly ApplicationStatus[]).includes(to);
}

export const STATUS_LABELS: Record<ApplicationStatus, string> = {
  SUBMITTED: "Submitted",
  REVIEWING: "In review",
  ACCEPTED: "Accepted",
  REJECTED: "Rejected",
  WITHDRAWN: "Withdrawn",
};
