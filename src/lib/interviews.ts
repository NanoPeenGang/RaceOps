import { InterviewKind, InterviewStatus } from "@prisma/client";

/**
 * Interview scheduling.
 *
 * The friction this removes is the email thread: a team suggests one time, the
 * applicant is at work, four days go by, and the seat is gone. So a team
 * proposes several times at once and the applicant picks one — one round trip
 * instead of five.
 *
 * Times are held in UTC and rendered in whoever is looking at them's own zone.
 * A team in Charlotte interviewing a driver in Munich is the ordinary case
 * here, and a naive local time puts somebody on a call at 3am.
 */

export const INTERVIEW_KIND_LABELS: Record<InterviewKind, string> = {
  VIDEO_CALL: "Video call",
  PHONE: "Phone call",
  IN_PERSON: "In person",
  TRACK_TEST: "Track test",
  WORK_TRIAL: "Work a weekend",
};

export const INTERVIEW_KIND_DESCRIPTIONS: Record<InterviewKind, string> = {
  VIDEO_CALL: "A call. Put the link in the location field.",
  PHONE: "A call. Put the number in the location field.",
  IN_PERSON: "At the shop or a meeting. Put the address in the location field.",
  TRACK_TEST:
    "A seat evaluation in the car. Needs a circuit, a date and usually a licence — the logistics are the interview.",
  WORK_TRIAL:
    "A trial working a real meeting, which is how most crew are actually hired.",
};

export const INTERVIEW_STATUS_LABELS: Record<InterviewStatus, string> = {
  PROPOSED: "Waiting on them",
  CONFIRMED: "Booked",
  DECLINED: "None of those worked",
  COMPLETED: "Done",
  CANCELED: "Canceled",
};

/**
 * How long the location field really wants for each kind.
 *
 * A hint for the form's placeholder, not a validation rule — a team that runs
 * its calls on a phone number nobody has heard of should not be stopped.
 */
export const LOCATION_PLACEHOLDERS: Record<InterviewKind, string> = {
  VIDEO_CALL: "https://meet.example.com/…",
  PHONE: "+1 555 0100",
  IN_PERSON: "Unit 4, Motorsport Park, Charlotte NC",
  TRACK_TEST: "Sebring International Raceway",
  WORK_TRIAL: "Sebring 12h — meet at the transporter Thursday 8am",
};

export interface SlotLike {
  startsAt: Date | string;
  chosen?: boolean;
}

export interface InterviewLike {
  status: InterviewStatus;
  scheduledAt?: Date | string | null;
  durationMinutes?: number;
  slots?: readonly SlotLike[];
}

export type SlotProblem =
  | { reason: "none"; message: string }
  | { reason: "past"; message: string }
  | { reason: "duplicate"; message: string }
  | { reason: "too-many"; message: string };

/**
 * How many times to offer at once.
 *
 * Three or four is a courtesy; twenty is a diary dump that makes the applicant
 * do the scheduling work the team was supposed to do.
 */
export const MAX_SLOTS = 8;

/**
 * Whether a set of proposed times can be sent.
 *
 * Returns a message somebody can act on. A slot in the past is the one that
 * actually happens — a team fills the form on Monday for "Friday" and sends it
 * the following week.
 */
export function checkSlots(
  slots: readonly (Date | string)[],
  now: Date = new Date(),
): SlotProblem | null {
  if (slots.length === 0) {
    return {
      reason: "none",
      message: "Offer at least one time, or there is nothing to accept.",
    };
  }
  if (slots.length > MAX_SLOTS) {
    return {
      reason: "too-many",
      message: `Offer at most ${MAX_SLOTS} times — more is a diary dump, not a choice.`,
    };
  }

  const seen = new Set<number>();
  for (const slot of slots) {
    const time = new Date(slot).getTime();
    if (Number.isNaN(time)) {
      return { reason: "past", message: "One of those times is not a date." };
    }
    if (time <= now.getTime()) {
      return {
        reason: "past",
        message: "One of those times has already passed.",
      };
    }
    if (seen.has(time)) {
      return { reason: "duplicate", message: "Two of those times are the same." };
    }
    seen.add(time);
  }
  return null;
}

/** Proposed times in order, soonest first. */
export function sortSlots<T extends SlotLike>(slots: readonly T[]): T[] {
  return [...slots].sort(
    (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
  );
}

/** The slot that was picked, if any. */
export function chosenSlot<T extends SlotLike>(
  slots: readonly T[],
): T | null {
  return slots.find((slot) => slot.chosen) ?? null;
}

/**
 * Whether an interview still needs somebody to do something, and who.
 *
 * The whole reason a team opens this panel: not "list the interviews" but
 * "which of these is waiting on me".
 */
export type InterviewWaiting = "applicant" | "team" | "nobody";

export function waitingOn(
  interview: InterviewLike,
  now: Date = new Date(),
): InterviewWaiting {
  switch (interview.status) {
    case InterviewStatus.PROPOSED:
      return "applicant";
    case InterviewStatus.DECLINED:
      // They could not make any of them, so the next move is the team's.
      return "team";
    case InterviewStatus.CONFIRMED:
      // Once it has happened, somebody has to say how it went — otherwise a
      // booked interview sits in the pipeline forever looking like a plan.
      return hasPassed(interview, now) ? "team" : "nobody";
    default:
      return "nobody";
  }
}

/** Whether a booked interview's end time is behind us. */
export function hasPassed(
  interview: InterviewLike,
  now: Date = new Date(),
): boolean {
  if (!interview.scheduledAt) return false;
  const end =
    new Date(interview.scheduledAt).getTime() +
    (interview.durationMinutes ?? 30) * 60_000;
  return end < now.getTime();
}

/**
 * The next interview a team should be getting ready for.
 *
 * Only booked ones with a future time. A proposed interview is not in the
 * diary, and putting it there would have people preparing for a call nobody
 * has agreed to.
 */
export function nextBooked<T extends InterviewLike>(
  interviews: readonly T[],
  now: Date = new Date(),
): T | null {
  return (
    interviews
      .filter(
        (interview) =>
          interview.status === InterviewStatus.CONFIRMED &&
          interview.scheduledAt != null &&
          new Date(interview.scheduledAt).getTime() >= now.getTime(),
      )
      .sort(
        (a, b) =>
          new Date(a.scheduledAt!).getTime() -
          new Date(b.scheduledAt!).getTime(),
      )[0] ?? null
  );
}

/**
 * "Thu 12 Mar, 14:30" with the zone named.
 *
 * The zone is never dropped. An interview time without one is the single most
 * expensive ambiguity in this whole feature — it is somebody missing a call
 * about a job.
 */
export function formatSlot(
  when: Date | string,
  locale?: string,
): string {
  const date = new Date(when);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

/** "30 minutes", "1h 30m" — how long to put aside. */
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} minutes`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}
