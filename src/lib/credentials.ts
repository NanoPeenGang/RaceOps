import { AccessZone, CredentialAudience, CredentialStatus } from "@prisma/client";

/**
 * Accreditation: who needs a pass, what it opens, and what a scan says.
 *
 * Everything here is pure so the same answers hold on the organizer's console,
 * on the printed sheet and on the page a marshal sees after scanning a QR code
 * at a gate. A pass that means one thing on the badge and another at the gate
 * is worse than no pass at all.
 */

export const ACCESS_ZONE_LABELS: Record<AccessZone, string> = {
  PADDOCK: "Paddock",
  GARAGE: "Garages",
  PIT_LANE: "Pit lane",
  GRID: "Grid",
  TRACKSIDE: "Trackside",
  RACE_CONTROL: "Race control",
  MEDIA_CENTRE: "Media centre",
  SCRUTINEERING: "Scrutineering",
  HOSPITALITY: "Hospitality",
};

/**
 * Order zones are listed in: outermost area first.
 *
 * Roughly how far in somebody is standing, which is the order a gate marshal
 * reads them in and the order they appear on a site plan.
 */
export const ACCESS_ZONE_ORDER: readonly AccessZone[] = [
  AccessZone.PADDOCK,
  AccessZone.HOSPITALITY,
  AccessZone.SCRUTINEERING,
  AccessZone.GARAGE,
  AccessZone.MEDIA_CENTRE,
  AccessZone.PIT_LANE,
  AccessZone.GRID,
  AccessZone.TRACKSIDE,
  AccessZone.RACE_CONTROL,
];

export const AUDIENCE_LABELS: Record<CredentialAudience, string> = {
  DRIVER: "Drivers",
  ENTRANT: "Entrants",
  VOLUNTEER: "Volunteers & officials",
  ORGANIZER: "Organizers & staff",
};

export const AUDIENCE_DESCRIPTIONS: Record<CredentialAudience, string> = {
  DRIVER: "Everyone named in a confirmed entry's driver line-up.",
  ENTRANT: "The person or team that entered, where they are not also driving.",
  VOLUNTEER: "Anyone signed up to a volunteer shift at this event.",
  ORGANIZER: "Series organizers and anyone holding a staff role here.",
};

/** Zones in reading order, deduplicated. */
export function sortZones(zones: readonly AccessZone[]): AccessZone[] {
  const held = new Set(zones);
  return ACCESS_ZONE_ORDER.filter((zone) => held.has(zone));
}

/**
 * What a pass opens, in one line: "Paddock · Pit lane · Grid".
 *
 * Returns null rather than an empty string for a pass with no zones set, so
 * callers show "access not specified" instead of a blank where a gate marshal
 * expects a list — silence there reads as "no restrictions".
 */
export function zoneSummary(zones: readonly AccessZone[]): string | null {
  const sorted = sortZones(zones);
  if (sorted.length === 0) return null;
  return sorted.map((zone) => ACCESS_ZONE_LABELS[zone]).join(" · ");
}

/**
 * Whether a pass in this state should admit its holder.
 *
 * Only a collected pass is in somebody's hand and therefore scannable at a
 * gate; an issued one is still on the accreditation desk. Both count as valid
 * because plenty of events hand passes out without ever marking them
 * collected, and a scan that says "invalid" for a pass the event itself
 * printed would teach marshals to ignore the result.
 */
export function isValidPass(status: CredentialStatus): boolean {
  return (
    status === CredentialStatus.ISSUED || status === CredentialStatus.COLLECTED
  );
}

/** Why a scan failed, in words for the person holding the phone. */
export function invalidReason(status: CredentialStatus): string | null {
  switch (status) {
    case CredentialStatus.REQUESTED:
      return "This pass has been requested but not issued. Send them to accreditation.";
    case CredentialStatus.VOID:
      return "This pass has been cancelled. Do not admit.";
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Working out who needs a pass
// ---------------------------------------------------------------------------

/**
 * Somebody the generator thinks needs a credential.
 *
 * `userId` is the identity where there is one, and the reason the sweep can
 * run twice without issuing the same person two passes. `name` is the fallback
 * for a crew member who has no account, which is most of them.
 */
export interface CredentialCandidate {
  audience: CredentialAudience;
  name: string;
  userId: string | null;
  /** Printed on the pass: "Driver", "Chief Scrutineer", "Marshal". */
  role: string | null;
  /** The entry this person is attached to, where they are attached to one. */
  registrationId: string | null;
  /** Shown on a scan so a gate can tell two Sam Smiths apart. */
  teamName: string | null;
  carNumber: string | null;
}

/** An existing pass, for deciding whether a candidate already has one. */
export interface IssuedLike {
  credentialTypeId: string;
  holderUserId: string | null;
  holderName: string;
  status: CredentialStatus;
}

/**
 * Identity of a pass-holder for de-duplication.
 *
 * Prefers the account id, because two people genuinely called Sam Smith must
 * both get a pass, and one person whose display name changed between rounds
 * must not get a second. Falls back to a normalised name for the majority of
 * crew who have no account at all.
 */
export function holderKey(holder: {
  holderUserId?: string | null;
  userId?: string | null;
  holderName?: string;
  name?: string;
}): string {
  const userId = holder.holderUserId ?? holder.userId ?? null;
  if (userId) return `user:${userId}`;
  const name = (holder.holderName ?? holder.name ?? "").trim().toLowerCase();
  return `name:${name.replace(/\s+/g, " ")}`;
}

export interface CredentialPlanEntry {
  candidate: CredentialCandidate;
  credentialTypeId: string;
  credentialTypeName: string;
}

export interface CredentialPlan {
  /** Passes that would be created. */
  toIssue: CredentialPlanEntry[];
  /** Candidates skipped because they already hold this pass. */
  alreadyHeld: number;
  /** Candidates matching no configured type, listed so nobody is missed. */
  unmatched: CredentialCandidate[];
}

export interface AudienceTypeLike {
  id: string;
  name: string;
  autoIssueTo: CredentialAudience | null;
}

/**
 * Works out which passes a sweep would create.
 *
 * Pure and separate from the writing so the console can show the organizer
 * exactly what is about to happen before it happens — a generator that issues
 * two hundred passes with no preview is one people run once and then never
 * trust again.
 *
 * Voided passes deliberately do **not** count as held. Somebody whose pass was
 * cancelled and who is now back on the entry list needs a new one, and leaving
 * them out of the sweep is how a driver ends up at a gate on Saturday morning
 * with nothing.
 */
export function planCredentials(
  candidates: readonly CredentialCandidate[],
  types: readonly AudienceTypeLike[],
  existing: readonly IssuedLike[],
): CredentialPlan {
  const byAudience = new Map<CredentialAudience, AudienceTypeLike>();
  for (const type of types) {
    // First type wins for an audience: two types claiming the same people
    // would issue everyone two passes, which is worse than ignoring one.
    if (type.autoIssueTo && !byAudience.has(type.autoIssueTo)) {
      byAudience.set(type.autoIssueTo, type);
    }
  }

  const held = new Set(
    existing
      .filter((pass) => pass.status !== CredentialStatus.VOID)
      .map((pass) => `${pass.credentialTypeId}|${holderKey(pass)}`),
  );

  const toIssue: CredentialPlanEntry[] = [];
  const unmatched: CredentialCandidate[] = [];
  // Two sweeps of the same list in one run must not double-issue either.
  const planned = new Set<string>();
  let alreadyHeld = 0;

  for (const candidate of candidates) {
    const type = byAudience.get(candidate.audience);
    if (!type) {
      unmatched.push(candidate);
      continue;
    }
    const key = `${type.id}|${holderKey(candidate)}`;
    if (held.has(key) || planned.has(key)) {
      alreadyHeld += 1;
      continue;
    }
    planned.add(key);
    toIssue.push({
      candidate,
      credentialTypeId: type.id,
      credentialTypeName: type.name,
    });
  }

  return { toIssue, alreadyHeld, unmatched };
}

/**
 * How a candidate reads on a pass and on a scan.
 *
 * Car number first because that is what a gate marshal is looking at when the
 * car is behind the person.
 */
export function holderSubtitle(candidate: {
  teamName: string | null;
  carNumber: string | null;
  role: string | null;
}): string | null {
  const parts = [
    candidate.carNumber ? `#${candidate.carNumber}` : null,
    candidate.teamName,
    candidate.role,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
}
