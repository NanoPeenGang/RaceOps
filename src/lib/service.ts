import { ServiceKind, ServiceStatus } from "@prisma/client";

/**
 * Car servicing: what was done, and what is coming due.
 *
 * A job can come due on the calendar (an annual logbook inspection) or on
 * running hours (a gearbox rebuild), and a team that tracks hours should get
 * the second without having to invent a date for it. Both are optional and
 * both are honoured; whichever arrives first is what the console warns about.
 */

export const SERVICE_KIND_LABELS: Record<ServiceKind, string> = {
  SCHEDULED: "Scheduled",
  REPAIR: "Repair",
  REBUILD: "Rebuild",
  INSPECTION: "Inspection",
  UPGRADE: "Upgrade",
};

export const SERVICE_STATUS_LABELS: Record<ServiceStatus, string> = {
  PLANNED: "Planned",
  IN_PROGRESS: "In progress",
  DONE: "Done",
  DEFERRED: "Deferred",
};

/** Statuses that still want somebody's attention. */
export const OPEN_SERVICE_STATUSES: readonly ServiceStatus[] = [
  ServiceStatus.PLANNED,
  ServiceStatus.IN_PROGRESS,
];

export function isOpen(status: ServiceStatus): boolean {
  return OPEN_SERVICE_STATUSES.includes(status);
}

/**
 * How close a job is to being needed.
 *
 * `unknown` is separate from `scheduled` on purpose: a completed job with no
 * next-due set has never been given an interval, and calling that "scheduled"
 * would promise a warning that is never going to come.
 */
export type ServiceUrgency = "overdue" | "due-soon" | "scheduled" | "unknown";

export const SERVICE_URGENCY_LABELS: Record<ServiceUrgency, string> = {
  overdue: "Overdue",
  "due-soon": "Due soon",
  scheduled: "Scheduled",
  unknown: "No interval set",
};

/**
 * How much warning to give.
 *
 * Two weeks, or five running hours. Both are roughly "the next event": a club
 * team wants to know a rebuild is coming while there is still time to book the
 * shop, and not so early that the warning becomes wallpaper.
 */
export const DUE_SOON_DAYS = 14;
export const DUE_SOON_HOURS = 5;

export interface DueRecord {
  nextDueOn?: Date | string | null;
  nextDueHours?: number | null;
}

export interface DueAssessment {
  urgency: ServiceUrgency;
  /** Days until due; negative when overdue. Null when not date-scheduled. */
  daysRemaining: number | null;
  /** Hours until due; negative when overdue. Null when hours are unknown. */
  hoursRemaining: number | null;
  /** Plain-language summary: "Overdue by 3 days", "Due in 2.0 hours". */
  summary: string;
}

/**
 * When a job comes due, by whichever measure arrives first.
 *
 * `runningHours` is nullable because most club cars have no hour meter. An
 * hours-based interval on a car that does not track hours is reported as
 * unknown rather than as fine — the interval exists, we just cannot say where
 * the car is against it, and pretending otherwise is how a rebuild gets missed.
 */
export function assessDue(
  record: DueRecord,
  runningHours: number | null | undefined,
  now: Date = new Date(),
): DueAssessment {
  const daysRemaining = record.nextDueOn
    ? (new Date(record.nextDueOn).getTime() - now.getTime()) / 86_400_000
    : null;

  const hoursRemaining =
    record.nextDueHours != null && runningHours != null
      ? record.nextDueHours - runningHours
      : null;

  if (daysRemaining === null && hoursRemaining === null) {
    return {
      urgency: "unknown",
      daysRemaining: null,
      hoursRemaining: null,
      summary:
        record.nextDueHours != null
          ? "Due on running hours — this car has no hours recorded."
          : "No interval set.",
    };
  }

  const overdueByDate = daysRemaining !== null && daysRemaining < 0;
  const overdueByHours = hoursRemaining !== null && hoursRemaining < 0;
  if (overdueByDate || overdueByHours) {
    return {
      urgency: "overdue",
      daysRemaining,
      hoursRemaining,
      summary: overdueByHours
        ? `Overdue by ${Math.abs(hoursRemaining!).toFixed(1)} hours.`
        : `Overdue by ${Math.abs(Math.floor(daysRemaining!))} days.`,
    };
  }

  const soonByDate = daysRemaining !== null && daysRemaining <= DUE_SOON_DAYS;
  const soonByHours =
    hoursRemaining !== null && hoursRemaining <= DUE_SOON_HOURS;
  if (soonByDate || soonByHours) {
    return {
      urgency: "due-soon",
      daysRemaining,
      hoursRemaining,
      summary: soonByHours
        ? `Due in ${hoursRemaining!.toFixed(1)} hours.`
        : `Due in ${Math.ceil(daysRemaining!)} days.`,
    };
  }

  return {
    urgency: "scheduled",
    daysRemaining,
    hoursRemaining,
    summary:
      daysRemaining !== null
        ? `Due in ${Math.ceil(daysRemaining)} days.`
        : `Due in ${hoursRemaining!.toFixed(1)} hours.`,
  };
}

/** Sort weight — the thing about to stop the car goes to the top. */
const URGENCY_RANK: Record<ServiceUrgency, number> = {
  overdue: 0,
  "due-soon": 1,
  scheduled: 2,
  unknown: 3,
};

export interface ServiceRecord extends DueRecord {
  status: ServiceStatus;
  performedOn?: Date | string | null;
}

export interface UpcomingService<T extends ServiceRecord> {
  service: T;
  assessment: DueAssessment;
}

/**
 * The service list a crew chief should be looking at, most urgent first.
 *
 * Deferred jobs are excluded: deferring one is a decision to stop being
 * reminded, and a "deferred" job that keeps appearing at the top of the list
 * is just a job nobody can silence.
 */
export function upcomingServices<T extends ServiceRecord>(
  services: readonly T[],
  runningHours: number | null | undefined,
  now: Date = new Date(),
): UpcomingService<T>[] {
  return services
    .filter((service) => service.status !== ServiceStatus.DEFERRED)
    .map((service) => ({
      service,
      assessment: assessDue(service, runningHours, now),
    }))
    .filter(({ assessment }) => assessment.urgency !== "unknown")
    .sort((a, b) => {
      const rank =
        URGENCY_RANK[a.assessment.urgency] - URGENCY_RANK[b.assessment.urgency];
      if (rank !== 0) return rank;
      const aDays = a.assessment.daysRemaining ?? Number.POSITIVE_INFINITY;
      const bDays = b.assessment.daysRemaining ?? Number.POSITIVE_INFINITY;
      return aDays - bDays;
    });
}

/**
 * Whether a car has anything that should stop it leaving for an event.
 *
 * Overdue only. "Due soon" is information; overdue is a decision, and
 * conflating them makes the warning that matters invisible.
 */
export function hasOverdueWork<T extends ServiceRecord>(
  services: readonly T[],
  runningHours: number | null | undefined,
  now: Date = new Date(),
): boolean {
  return upcomingServices(services, runningHours, now).some(
    ({ assessment }) => assessment.urgency === "overdue",
  );
}
