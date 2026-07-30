import { IncidentSource, IncidentStatus } from "@prisma/client";

/**
 * Incident triage.
 *
 * A report is the input to stewarding; the queue is how race control works
 * through it. The transitions below are the whole workflow: everything else in
 * the router is authorization and record-keeping.
 */

export const INCIDENT_SOURCE_LABELS: Record<IncidentSource, string> = {
  COMPETITOR: "Competitor report",
  MARSHAL: "Marshal post",
  RACE_CONTROL: "Race control",
  PROTEST: "Formal protest",
};

export const INCIDENT_STATUS_LABELS: Record<IncidentStatus, string> = {
  REPORTED: "Reported",
  NOTED: "Noted",
  UNDER_INVESTIGATION: "Under investigation",
  NO_FURTHER_ACTION: "No further action",
  PENALTY_ISSUED: "Penalty issued",
  WITHDRAWN: "Withdrawn",
};

/** Statuses still needing race control's attention. */
export const OPEN_INCIDENT_STATUSES: IncidentStatus[] = [
  IncidentStatus.REPORTED,
  IncidentStatus.NOTED,
  IncidentStatus.UNDER_INVESTIGATION,
];

/** Statuses that close a report. */
export const CLOSED_INCIDENT_STATUSES: IncidentStatus[] = [
  IncidentStatus.NO_FURTHER_ACTION,
  IncidentStatus.PENALTY_ISSUED,
  IncidentStatus.WITHDRAWN,
];

export function isIncidentOpen(status: IncidentStatus): boolean {
  return OPEN_INCIDENT_STATUSES.includes(status);
}

const TRANSITIONS: Record<IncidentStatus, IncidentStatus[]> = {
  REPORTED: [
    IncidentStatus.NOTED,
    IncidentStatus.UNDER_INVESTIGATION,
    IncidentStatus.NO_FURTHER_ACTION,
    IncidentStatus.WITHDRAWN,
  ],
  // "Noted" is the flag race control raises during a session and comes back to.
  NOTED: [
    IncidentStatus.UNDER_INVESTIGATION,
    IncidentStatus.NO_FURTHER_ACTION,
    IncidentStatus.WITHDRAWN,
  ],
  UNDER_INVESTIGATION: [
    IncidentStatus.NO_FURTHER_ACTION,
    IncidentStatus.WITHDRAWN,
  ],
  // A closed report stays closed. Re-opening the same facts would let a
  // decision be quietly revisited; a fresh report is the honest route.
  NO_FURTHER_ACTION: [],
  PENALTY_ISSUED: [],
  WITHDRAWN: [],
};

export function canTransitionIncident(
  from: IncidentStatus,
  to: IncidentStatus,
): boolean {
  if (from === to) return false;
  return TRANSITIONS[from].includes(to);
}

export function nextIncidentStatuses(from: IncidentStatus): IncidentStatus[] {
  return TRANSITIONS[from];
}

/**
 * Whether a report can still produce a penalty.
 *
 * `PENALTY_ISSUED` is reached by issuing one rather than by a status change, so
 * it is deliberately absent from the transition table above.
 */
export function canIssuePenaltyFor(status: IncidentStatus): boolean {
  return isIncidentOpen(status);
}

export interface IncidentRecord {
  id: string;
  status: IncidentStatus;
  source: IncidentSource;
  lapNumber: number | null;
  createdAt: Date;
}

/**
 * Queue order: open reports first, formal protests ahead of casual ones within
 * that, then oldest first — a queue is worked from the front.
 */
export function sortIncidentQueue<T extends IncidentRecord>(rows: T[]): T[] {
  const sourceRank = (source: IncidentSource) =>
    source === IncidentSource.PROTEST ? 0 : 1;

  return [...rows].sort((a, b) => {
    const aOpen = isIncidentOpen(a.status);
    const bOpen = isIncidentOpen(b.status);
    if (aOpen !== bOpen) return aOpen ? -1 : 1;
    const rank = sourceRank(a.source) - sourceRank(b.source);
    if (rank !== 0) return rank;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });
}

export interface QueueSummary {
  open: number;
  investigating: number;
  protests: number;
  closed: number;
}

export function summarizeQueue(rows: IncidentRecord[]): QueueSummary {
  let open = 0;
  let investigating = 0;
  let protests = 0;
  let closed = 0;

  for (const row of rows) {
    if (isIncidentOpen(row.status)) {
      open += 1;
      if (row.status === IncidentStatus.UNDER_INVESTIGATION) investigating += 1;
      if (row.source === IncidentSource.PROTEST) protests += 1;
    } else {
      closed += 1;
    }
  }
  return { open, investigating, protests, closed };
}

/**
 * "Lap 12, Turn 5 (Eau Rouge)" from whichever parts were supplied.
 *
 * A named turn wins over the free-text field: when the event runs a known
 * layout the corner is a reference stewards and marshals share, whereas the
 * free text is whatever the reporter typed. The free text is still appended
 * when it says something the turn does not ("pit exit", "on the recovery road").
 */
export function describeIncidentLocation(incident: {
  lapNumber: number | null;
  location: string | null;
  turn?: { number: number; name: string | null } | null;
}): string {
  const turn = incident.turn
    ? incident.turn.name
      ? `Turn ${incident.turn.number} (${incident.turn.name})`
      : `Turn ${incident.turn.number}`
    : null;
  const freeText =
    incident.location && incident.location !== turn ? incident.location : null;
  const parts = [
    incident.lapNumber !== null ? `Lap ${incident.lapNumber}` : null,
    turn,
    freeText,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : "Location not given";
}
