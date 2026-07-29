import {
  EventStatus,
  RegistrationStatus,
  VolunteerSignupStatus,
} from "@prisma/client";

/**
 * Pure event-organization rules, shared by the tRPC routers and the UI.
 * Kept free of Prisma client calls so they are directly testable.
 */

export interface RegistrationWindow {
  status: EventStatus;
  registrationOpensAt: Date | null;
  registrationClosesAt: Date | null;
}

export type RegistrationWindowState =
  | "open"
  | "not_published"
  | "not_yet_open"
  | "closed"
  | "event_canceled";

export function registrationWindowState(
  event: RegistrationWindow,
  now: Date = new Date(),
): RegistrationWindowState {
  if (event.status === EventStatus.CANCELED) return "event_canceled";
  if (event.status !== EventStatus.PUBLISHED) return "not_published";
  if (event.registrationOpensAt && now < event.registrationOpensAt) {
    return "not_yet_open";
  }
  if (event.registrationClosesAt && now > event.registrationClosesAt) {
    return "closed";
  }
  return "open";
}

export function isRegistrationOpen(
  event: RegistrationWindow,
  now: Date = new Date(),
): boolean {
  return registrationWindowState(event, now) === "open";
}

/** Statuses that occupy a grid slot against the event's entry capacity. */
export const SLOT_CONSUMING_STATUSES: RegistrationStatus[] = [
  RegistrationStatus.CONFIRMED,
];

export function hasCapacityForConfirm(
  entryCapacity: number | null,
  confirmedCount: number,
): boolean {
  if (entryCapacity === null) return true;
  return confirmedCount < entryCapacity;
}

/** Statuses an organizer may assign. WITHDRAWN belongs to the entrant. */
export const ORGANIZER_SETTABLE_REGISTRATION_STATUSES = [
  RegistrationStatus.PENDING,
  RegistrationStatus.CONFIRMED,
  RegistrationStatus.WAITLISTED,
  RegistrationStatus.REJECTED,
] as const;

export function canOrganizerSetRegistrationStatus(
  from: RegistrationStatus,
  to: RegistrationStatus,
): boolean {
  if (from === to) return false;
  // The entrant owns withdrawal, in both directions.
  if (from === RegistrationStatus.WITHDRAWN) return false;
  return (
    ORGANIZER_SETTABLE_REGISTRATION_STATUSES as readonly RegistrationStatus[]
  ).includes(to);
}

/**
 * Picks the registration to promote when a confirmed slot frees up:
 * the longest-waiting waitlisted entry.
 */
export function nextWaitlistPromotion<
  T extends { id: string; status: RegistrationStatus; createdAt: Date },
>(registrations: T[]): T | null {
  const waiting = registrations
    .filter((r) => r.status === RegistrationStatus.WAITLISTED)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  return waiting[0] ?? null;
}

/** Volunteer statuses that occupy one of a shift's slots. */
export const ACTIVE_VOLUNTEER_STATUSES: VolunteerSignupStatus[] = [
  VolunteerSignupStatus.SIGNED_UP,
  VolunteerSignupStatus.CONFIRMED,
];

export function isActiveVolunteerStatus(
  status: VolunteerSignupStatus,
): boolean {
  return ACTIVE_VOLUNTEER_STATUSES.includes(status);
}

/**
 * A new signup takes a slot if one is free, otherwise joins the waitlist.
 */
export function resolveVolunteerSignupStatus(
  capacity: number,
  activeCount: number,
): VolunteerSignupStatus {
  return activeCount < capacity
    ? VolunteerSignupStatus.SIGNED_UP
    : VolunteerSignupStatus.WAITLISTED;
}

export interface ShiftCoverage {
  capacity: number;
  filled: number;
  waitlisted: number;
  remaining: number;
  isFull: boolean;
}

export function shiftCoverage(
  capacity: number,
  signups: { status: VolunteerSignupStatus }[],
): ShiftCoverage {
  const filled = signups.filter((s) => isActiveVolunteerStatus(s.status)).length;
  const waitlisted = signups.filter(
    (s) => s.status === VolunteerSignupStatus.WAITLISTED,
  ).length;
  return {
    capacity,
    filled,
    waitlisted,
    remaining: Math.max(0, capacity - filled),
    isFull: filled >= capacity,
  };
}

const EVENT_TRANSITIONS: Record<EventStatus, EventStatus[]> = {
  [EventStatus.DRAFT]: [EventStatus.PUBLISHED, EventStatus.CANCELED],
  [EventStatus.PUBLISHED]: [EventStatus.COMPLETED, EventStatus.CANCELED],
  [EventStatus.COMPLETED]: [],
  [EventStatus.CANCELED]: [],
};

export function canTransitionEvent(
  from: EventStatus,
  to: EventStatus,
): boolean {
  return EVENT_TRANSITIONS[from].includes(to);
}

export const REGISTRATION_STATUS_LABELS: Record<RegistrationStatus, string> = {
  PENDING: "Pending review",
  CONFIRMED: "Confirmed",
  WAITLISTED: "Waitlisted",
  REJECTED: "Rejected",
  WITHDRAWN: "Withdrawn",
};

export const EVENT_STATUS_LABELS: Record<EventStatus, string> = {
  DRAFT: "Draft",
  PUBLISHED: "Published",
  COMPLETED: "Completed",
  CANCELED: "Canceled",
};

export const VOLUNTEER_ROLE_LABELS: Record<string, string> = {
  MARSHAL: "Marshal",
  FLAG: "Flag point",
  TIMING: "Timing & scoring",
  SCRUTINEER: "Scrutineering",
  MEDICAL: "Medical",
  GRID: "Grid",
  PIT_LANE: "Pit lane",
  MEDIA: "Media",
  OTHER: "Other",
};
