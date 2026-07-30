import { CredentialStatus } from "@prisma/client";

/**
 * Paddock allocation and credentials.
 *
 * Both are spreadsheet work today, and both have the same failure: nobody
 * finds out a garage is double-booked or an entry is four passes over until
 * the Thursday. The logic here is what turns those into things a page can say
 * before anyone drives to the circuit.
 */

export interface AllocationLike {
  registrationId: string;
  garage?: string | null;
  pitBox?: string | null;
  paddockSpace?: string | null;
  transporterBay?: string | null;
}

/** The allocation fields that must not be handed to two entries at once. */
const EXCLUSIVE_FIELDS = [
  "garage",
  "pitBox",
  "paddockSpace",
  "transporterBay",
] as const;

type ExclusiveField = (typeof EXCLUSIVE_FIELDS)[number];

export const ALLOCATION_FIELD_LABELS: Record<ExclusiveField, string> = {
  garage: "Garage",
  pitBox: "Pit box",
  paddockSpace: "Paddock space",
  transporterBay: "Transporter bay",
};

export interface AllocationClash {
  field: ExclusiveField;
  value: string;
  registrationIds: string[];
}

/**
 * Places handed to more than one entry.
 *
 * Labels are compared case- and space-insensitively: "Garage 4" and "garage
 * 4" are the same garage, and an allocation sheet typed by three people over
 * two weeks will contain both. Empty values are not clashes — plenty of
 * entries have no garage at all.
 */
export function allocationClashes(
  allocations: AllocationLike[],
): AllocationClash[] {
  const clashes: AllocationClash[] = [];

  for (const field of EXCLUSIVE_FIELDS) {
    const byValue = new Map<string, { label: string; ids: string[] }>();
    for (const allocation of allocations) {
      const raw = allocation[field];
      const value = raw?.trim();
      if (!value) continue;
      const key = normalizePlace(value);
      const bucket = byValue.get(key);
      if (bucket) bucket.ids.push(allocation.registrationId);
      else byValue.set(key, { label: value, ids: [allocation.registrationId] });
    }
    for (const { label, ids } of byValue.values()) {
      if (ids.length > 1) {
        clashes.push({ field, value: label, registrationIds: ids });
      }
    }
  }

  return clashes;
}

/** Case- and whitespace-insensitive key for comparing place labels. */
export function normalizePlace(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Whether the allocation fits the venue.
 *
 * `pitBoxCount` comes from the Track record. Returns null when the venue has
 * no count recorded, which is the normal state for a club circuit — an unknown
 * capacity is not an over-allocation.
 */
export function pitBoxOverflow(
  allocations: AllocationLike[],
  pitBoxCount: number | null | undefined,
): number | null {
  if (pitBoxCount === null || pitBoxCount === undefined) return null;
  const used = new Set(
    allocations
      .map((allocation) => allocation.pitBox?.trim())
      .filter((box): box is string => Boolean(box))
      .map(normalizePlace),
  );
  return Math.max(0, used.size - pitBoxCount);
}

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

export const CREDENTIAL_STATUS_LABELS: Record<CredentialStatus, string> = {
  REQUESTED: "Requested",
  ISSUED: "Issued",
  COLLECTED: "Collected",
  VOID: "Void",
};

/**
 * Statuses that consume a pass.
 *
 * A requested pass counts: the whole point of an allowance is to stop an entry
 * asking for twelve. A voided pass does not, which is why voiding exists
 * rather than deleting — a pass that vanishes cannot be audited.
 */
export const COUNTED_CREDENTIAL_STATUSES: CredentialStatus[] = [
  CredentialStatus.REQUESTED,
  CredentialStatus.ISSUED,
  CredentialStatus.COLLECTED,
];

export interface CredentialLike {
  credentialTypeId: string;
  status: CredentialStatus;
}

export interface CredentialTypeLike {
  id: string;
  name: string;
  allowancePerEntry: number;
  totalAvailable?: number | null;
}

export interface CredentialCount {
  typeId: string;
  typeName: string;
  used: number;
  allowance: number;
  remaining: number;
  overAllowance: boolean;
}

/** How one entry stands against each pass allowance. */
export function credentialCounts(
  types: CredentialTypeLike[],
  credentials: CredentialLike[],
): CredentialCount[] {
  return types.map((type) => {
    const used = credentials.filter(
      (credential) =>
        credential.credentialTypeId === type.id &&
        COUNTED_CREDENTIAL_STATUSES.includes(credential.status),
    ).length;
    return {
      typeId: type.id,
      typeName: type.name,
      used,
      allowance: type.allowancePerEntry,
      remaining: type.allowancePerEntry - used,
      overAllowance: used > type.allowancePerEntry,
    };
  });
}

export interface TypeIssuance {
  typeId: string;
  typeName: string;
  issued: number;
  totalAvailable: number | null;
  remaining: number | null;
  exhausted: boolean;
}

/** How the event as a whole stands against each pass cap. */
export function eventIssuance(
  types: CredentialTypeLike[],
  credentials: CredentialLike[],
): TypeIssuance[] {
  return types.map((type) => {
    const issued = credentials.filter(
      (credential) =>
        credential.credentialTypeId === type.id &&
        COUNTED_CREDENTIAL_STATUSES.includes(credential.status),
    ).length;
    const total = type.totalAvailable ?? null;
    return {
      typeId: type.id,
      typeName: type.name,
      issued,
      totalAvailable: total,
      remaining: total === null ? null : total - issued,
      exhausted: total !== null && issued >= total,
    };
  });
}

/** "Garage 12 · Pit box 4 · Paddock P14", or null when nothing is allocated. */
export function describeAllocation(
  allocation: AllocationLike | null | undefined,
): string | null {
  if (!allocation) return null;
  const parts = EXCLUSIVE_FIELDS.map((field) => {
    const value = allocation[field]?.trim();
    return value ? `${ALLOCATION_FIELD_LABELS[field]} ${value}` : null;
  }).filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
}
