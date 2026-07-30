import { TireSetStatus } from "@prisma/client";

/**
 * Cars, transponders and tire allocation.
 *
 * All three are the paperwork side of a race weekend that is currently a
 * spreadsheet: which chassis is entered, which transponder the timing feed
 * should see, and how many sets of tires an entry has left.
 */

export interface CarLike {
  name: string;
  make?: string | null;
  model?: string | null;
  year?: number | null;
  chassisNumber?: string | null;
  classLabel?: string | null;
}

/**
 * How a car reads on an entry list: "2019 Porsche 911 GT3 R — Car 7". The
 * crew's own name for it comes last because make and model are what a reader
 * scans for, but the crew's name is what identifies it in the paddock.
 */
export function carLabel(car: CarLike): string {
  const spec = [car.year ? String(car.year) : null, car.make, car.model]
    .filter(Boolean)
    .join(" ");
  return spec ? `${spec} — ${car.name}` : car.name;
}

/** Short form for a timing sheet column. */
export function carShortLabel(car: CarLike): string {
  const spec = [car.make, car.model].filter(Boolean).join(" ");
  return spec || car.name;
}

/** Owner side of a car, for scoping queries and permission checks. */
export function carOwner(car: {
  teamId?: string | null;
  ownerUserId?: string | null;
}): { kind: "team"; id: string } | { kind: "user"; id: string } | null {
  if (car.teamId) return { kind: "team", id: car.teamId };
  if (car.ownerUserId) return { kind: "user", id: car.ownerUserId };
  // A CHECK constraint makes this unreachable in the database; kept so callers
  // never have to assume.
  return null;
}

// ---------------------------------------------------------------------------
// Transponders
// ---------------------------------------------------------------------------

/**
 * Normalizes a transponder number for matching.
 *
 * Timing exports write the same unit as "1234567", "1 234 567" and
 * "TR-1234567" depending on the system. Matching on the raw string means a
 * feed silently fails to reconcile against half the grid.
 */
export function normalizeTransponderNumber(input: string): string {
  return input.trim().toUpperCase().replace(/[\s-]+/g, "");
}

export interface AssignmentLike {
  registrationId: string;
  isPrimary: boolean;
  transponder: { number: string };
}

/**
 * Index of transponder number -> registration, for reconciling a timing feed.
 * Numbers are normalized on both sides, so a feed that writes them differently
 * still resolves.
 */
export function transponderIndex(
  assignments: AssignmentLike[],
): Map<string, string> {
  const index = new Map<string, string>();
  for (const assignment of assignments) {
    index.set(
      normalizeTransponderNumber(assignment.transponder.number),
      assignment.registrationId,
    );
  }
  return index;
}

/** The entry a timing row belongs to, or null when nothing matches. */
export function resolveTransponder(
  index: Map<string, string>,
  number: string,
): string | null {
  return index.get(normalizeTransponderNumber(number)) ?? null;
}

// ---------------------------------------------------------------------------
// Tire allocation
// ---------------------------------------------------------------------------

/**
 * Sets that count against an entry's allowance.
 *
 * A returned set still counts — it was issued and used. Only a voided set
 * (mis-scanned, damaged before it ever went on) is written off, which is the
 * whole reason `VOID` exists as a status rather than deleting the row: an
 * allocation that vanishes is one nobody can audit.
 */
export const COUNTED_TIRE_STATUSES: TireSetStatus[] = [
  TireSetStatus.ALLOCATED,
  TireSetStatus.FITTED,
  TireSetStatus.RETURNED,
];

export interface TireSetLike {
  status: TireSetStatus;
}

export interface TireAllocation {
  used: number;
  /// Null when the event sets no allowance.
  allowance: number | null;
  remaining: number | null;
  overAllowance: boolean;
  fitted: number;
  voided: number;
}

export function tireAllocation(
  sets: TireSetLike[],
  allowance: number | null | undefined,
): TireAllocation {
  const used = sets.filter((set) =>
    COUNTED_TIRE_STATUSES.includes(set.status),
  ).length;
  const limit = allowance ?? null;
  return {
    used,
    allowance: limit,
    remaining: limit === null ? null : limit - used,
    overAllowance: limit !== null && used > limit,
    fitted: sets.filter((set) => set.status === TireSetStatus.FITTED).length,
    voided: sets.filter((set) => set.status === TireSetStatus.VOID).length,
  };
}

export const TIRE_STATUS_LABELS: Record<TireSetStatus, string> = {
  ALLOCATED: "Allocated",
  FITTED: "Fitted",
  RETURNED: "Returned",
  VOID: "Void",
};

/** "3 of 6 sets used · 3 remaining", or the unlimited form. */
export function describeAllocation(allocation: TireAllocation): string {
  if (allocation.allowance === null) {
    return `${allocation.used} set${allocation.used === 1 ? "" : "s"} allocated · no limit`;
  }
  const over = allocation.overAllowance
    ? ` · ${allocation.used - allocation.allowance} over the allowance`
    : ` · ${allocation.remaining} remaining`;
  return `${allocation.used} of ${allocation.allowance} sets used${over}`;
}
