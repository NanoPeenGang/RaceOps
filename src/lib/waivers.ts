import { WaiverAudience } from "@prisma/client";

/**
 * Waivers and e-signature.
 *
 * A typed-name e-signature is what the great majority of motorsport
 * organizers accept. What makes it hold up is not the signature but the
 * record around it — the exact wording version, the time, and evidence of
 * where it came from — which is why the checks here are about matching a
 * signature to a *version*, never just to a waiver.
 */

export const WAIVER_AUDIENCE_LABELS: Record<WaiverAudience, string> = {
  ALL_PARTICIPANTS: "Everyone on an entry",
  DRIVERS: "Drivers",
  CREW: "Crew",
  VOLUNTEERS: "Volunteers",
  CREDENTIAL_HOLDERS: "Anyone with a pass",
};

export const WAIVER_AUDIENCE_DESCRIPTIONS: Record<WaiverAudience, string> = {
  ALL_PARTICIPANTS:
    "Every driver and crew member declared on an entry must sign.",
  DRIVERS: "Only the declared drivers must sign.",
  CREW: "Crew declared on an entry must sign; drivers are covered elsewhere.",
  VOLUNTEERS: "Marshals and other volunteers working the event must sign.",
  CREDENTIAL_HOLDERS:
    "Everyone issued a pass, including guests, must sign before collecting it.",
};

/** Roles a person can hold at an event, for matching against an audience. */
export type ParticipantRole = "driver" | "crew" | "volunteer" | "pass_holder";

/**
 * Whether someone in a given role has to sign a waiver.
 *
 * `ALL_PARTICIPANTS` covers drivers and crew but not volunteers, who work for
 * the organizer rather than an entrant and are usually covered by a separate
 * document. A pass holder is covered only by `CREDENTIAL_HOLDERS`, since a
 * guest with a paddock pass is not "on an entry" in any useful sense.
 */
export function audienceCovers(
  audience: WaiverAudience,
  role: ParticipantRole,
): boolean {
  switch (audience) {
    case WaiverAudience.ALL_PARTICIPANTS:
      return role === "driver" || role === "crew";
    case WaiverAudience.DRIVERS:
      return role === "driver";
    case WaiverAudience.CREW:
      return role === "crew";
    case WaiverAudience.VOLUNTEERS:
      return role === "volunteer";
    case WaiverAudience.CREDENTIAL_HOLDERS:
      return role === "pass_holder";
  }
}

export interface WaiverLike {
  id: string;
  title: string;
  version: number;
  audience: WaiverAudience;
  required: boolean;
  active: boolean;
  minSigningAge?: number | null;
}

export interface SignatureLike {
  waiverId: string;
  waiverVersion: number;
  signerUserId: string | null;
  signedName: string;
}

/**
 * Whether a person has signed the *current* version of a waiver.
 *
 * Version matters: a signature against v1 does not cover v2. That is the
 * whole reason wording changes bump a version rather than editing in place —
 * an organizer who fixes a typo has not invalidated anything, but one who
 * changes the indemnity has, and only the version number can tell them apart.
 */
export function hasSigned(
  waiver: WaiverLike,
  signatures: SignatureLike[],
  userId: string,
): boolean {
  return signatures.some(
    (signature) =>
      signature.waiverId === waiver.id &&
      signature.waiverVersion === waiver.version &&
      signature.signerUserId === userId,
  );
}

export interface WaiverStatus {
  waiverId: string;
  title: string;
  version: number;
  required: boolean;
  signed: boolean;
  /// True when they signed an earlier version and the wording has since moved.
  signedOldVersion: boolean;
}

/** How one person stands against every waiver that applies to their role. */
export function waiverStatuses(
  waivers: WaiverLike[],
  signatures: SignatureLike[],
  userId: string,
  role: ParticipantRole,
): WaiverStatus[] {
  return waivers
    .filter((waiver) => waiver.active && audienceCovers(waiver.audience, role))
    .map((waiver) => {
      const mine = signatures.filter(
        (signature) =>
          signature.waiverId === waiver.id &&
          signature.signerUserId === userId,
      );
      return {
        waiverId: waiver.id,
        title: waiver.title,
        version: waiver.version,
        required: waiver.required,
        signed: mine.some(
          (signature) => signature.waiverVersion === waiver.version,
        ),
        signedOldVersion:
          mine.length > 0 &&
          !mine.some((signature) => signature.waiverVersion === waiver.version),
      };
    });
}

/** The required waivers still unsigned — what blocks a confirmation. */
export function outstandingWaivers(statuses: WaiverStatus[]): WaiverStatus[] {
  return statuses.filter((status) => status.required && !status.signed);
}

/**
 * Whether a typed name is an acceptable signature.
 *
 * Deliberately permissive about form — people sign as "R. Smith", "Bob" and
 * "Roberta Smith-Okonkwo" — but it must be a name they typed rather than a
 * click-through, which is what an empty or single-character value would be.
 * Legal names are not validated against the profile: the signer may be a
 * guest with no account at all.
 */
export function isAcceptableSignature(typed: string): boolean {
  const trimmed = typed.trim();
  return trimmed.length >= 2 && /\p{L}/u.test(trimmed);
}

/**
 * Whether someone may sign for themselves at this event.
 *
 * Below the waiver's minimum signing age a guardian signs instead — the one
 * part of motorsport paperwork that absolutely cannot be waved through, since
 * a minor's signature on an indemnity is worth nothing.
 *
 * Returns `unknown` when the waiver sets an age and the signer's date of birth
 * is not on file, so the caller asks rather than assuming either way.
 */
export function signingCapacity(
  waiver: Pick<WaiverLike, "minSigningAge">,
  dateOfBirth: Date | null | undefined,
  at: Date = new Date(),
): "self" | "guardian" | "unknown" {
  if (!waiver.minSigningAge) return "self";
  if (!dateOfBirth) return "unknown";
  return ageAt(dateOfBirth, at) >= waiver.minSigningAge ? "self" : "guardian";
}

/** Whole years old at a date, counting the birthday itself. */
export function ageAt(dateOfBirth: Date, at: Date): number {
  let age = at.getFullYear() - dateOfBirth.getFullYear();
  const monthDiff = at.getMonth() - dateOfBirth.getMonth();
  if (
    monthDiff < 0 ||
    (monthDiff === 0 && at.getDate() < dateOfBirth.getDate())
  ) {
    age -= 1;
  }
  return age;
}
