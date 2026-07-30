import { RequirementEnforcement, RequirementKind } from "@prisma/client";

/**
 * Entry eligibility.
 *
 * Requirements are checked per driver, not per entry — it is the people in the
 * car who hold licences, and an endurance crew can be three-quarters compliant.
 * Nothing here throws: an organizer needs to see the whole picture, including
 * the parts that are only advisory, before deciding to confirm or waive.
 */

export const REQUIREMENT_KIND_LABELS: Record<RequirementKind, string> = {
  CREDENTIAL: "Credential",
  SIM_RATING: "Sim rating",
  MIN_AGE: "Minimum age",
  ACKNOWLEDGEMENT: "Sign-off",
};

export const ENFORCEMENT_LABELS: Record<RequirementEnforcement, string> = {
  BLOCKING: "Blocks entry",
  ADVISORY: "Advisory",
};

export interface Requirement {
  id: string;
  seriesClassId: string | null;
  kind: RequirementKind;
  label: string;
  enforcement: RequirementEnforcement;
  credentialKind: string | null;
  simPlatform: string | null;
  minRating: number | null;
  minAge: number | null;
  active: boolean;
}

export interface DriverProfile {
  userId: string;
  displayName: string;
  dateOfBirth: Date | null;
  credentialKinds: string[];
  /** Raw `Profile.simStats`, keyed by platform. */
  simStats: unknown;
}

/** An organizer's explicit decision, which overrides the automatic check. */
export interface WaiverRecord {
  requirementId: string;
  userId: string;
  granted: boolean;
}

export type EligibilityState =
  | "met"
  | "not_met"
  /** Cannot be determined automatically; needs an organizer's sign-off. */
  | "needs_signoff"
  /** An organizer granted it explicitly. */
  | "waived"
  /** An organizer explicitly refused it. */
  | "refused";

export interface EligibilityFinding {
  requirementId: string;
  requirementLabel: string;
  kind: RequirementKind;
  enforcement: RequirementEnforcement;
  userId: string;
  driverName: string;
  state: EligibilityState;
  detail: string;
}

/** Requirements that apply to an entry in a given class. */
export function requirementsFor(
  requirements: Requirement[],
  seriesClassId: string | null,
): Requirement[] {
  return requirements.filter(
    (requirement) =>
      requirement.active &&
      // A null scope applies series-wide; otherwise it must match the class.
      (requirement.seriesClassId === null ||
        requirement.seriesClassId === seriesClassId),
  );
}

/** Whole years between a birth date and a reference date. */
export function ageAt(dateOfBirth: Date, on: Date): number {
  let age = on.getFullYear() - dateOfBirth.getFullYear();
  const monthDelta = on.getMonth() - dateOfBirth.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && on.getDate() < dateOfBirth.getDate())) {
    age -= 1;
  }
  return age;
}

/**
 * Reads a rating out of the stored sim stats blob.
 *
 * The blob is organizer-supplied JSON, so anything unexpected reads as "no
 * rating" rather than throwing and taking down the entry list.
 */
export function ratingFor(simStats: unknown, platform: string): number | null {
  if (!simStats || typeof simStats !== "object" || Array.isArray(simStats)) {
    return null;
  }
  const entry = (simStats as Record<string, unknown>)[platform];
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const rating = (entry as Record<string, unknown>).iRating;
  return typeof rating === "number" && Number.isFinite(rating) ? rating : null;
}

export interface EligibilityInput {
  requirements: Requirement[];
  seriesClassId: string | null;
  drivers: DriverProfile[];
  waivers: WaiverRecord[];
  /** The event date, for age checks. */
  on?: Date;
}

/**
 * Evaluates every applicable requirement against every declared driver.
 *
 * An entry with no declared drivers yields no findings — there is nobody to
 * check yet, which is a line-up problem rather than an eligibility one.
 */
export function checkEligibility(input: EligibilityInput): EligibilityFinding[] {
  const on = input.on ?? new Date();
  const applicable = requirementsFor(input.requirements, input.seriesClassId);
  const findings: EligibilityFinding[] = [];

  for (const requirement of applicable) {
    for (const driver of input.drivers) {
      const waiver = input.waivers.find(
        (candidate) =>
          candidate.requirementId === requirement.id &&
          candidate.userId === driver.userId,
      );

      // An explicit decision always wins over the automatic check: that is the
      // point of recording one.
      if (waiver) {
        findings.push({
          requirementId: requirement.id,
          requirementLabel: requirement.label,
          kind: requirement.kind,
          enforcement: requirement.enforcement,
          userId: driver.userId,
          driverName: driver.displayName,
          state: waiver.granted ? "waived" : "refused",
          detail: waiver.granted
            ? "Signed off by an organizer."
            : "Refused by an organizer.",
        });
        continue;
      }

      findings.push({
        requirementId: requirement.id,
        requirementLabel: requirement.label,
        kind: requirement.kind,
        enforcement: requirement.enforcement,
        userId: driver.userId,
        driverName: driver.displayName,
        ...evaluate(requirement, driver, on),
      });
    }
  }

  return findings;
}

function evaluate(
  requirement: Requirement,
  driver: DriverProfile,
  on: Date,
): { state: EligibilityState; detail: string } {
  switch (requirement.kind) {
    case "CREDENTIAL": {
      if (!requirement.credentialKind) {
        return { state: "needs_signoff", detail: "No credential kind set." };
      }
      const held = driver.credentialKinds.includes(requirement.credentialKind);
      return held
        ? { state: "met", detail: `Holds ${requirement.credentialKind}.` }
        : {
            state: "not_met",
            detail: `No ${requirement.credentialKind} on their profile.`,
          };
    }

    case "SIM_RATING": {
      if (!requirement.simPlatform || requirement.minRating === null) {
        return { state: "needs_signoff", detail: "No rating threshold set." };
      }
      const rating = ratingFor(driver.simStats, requirement.simPlatform);
      if (rating === null) {
        return {
          state: "not_met",
          detail: `No ${requirement.simPlatform} rating on their profile.`,
        };
      }
      return rating >= requirement.minRating
        ? { state: "met", detail: `Rating ${rating}.` }
        : {
            state: "not_met",
            detail: `Rating ${rating} is below the ${requirement.minRating} minimum.`,
          };
    }

    case "MIN_AGE": {
      if (requirement.minAge === null) {
        return { state: "needs_signoff", detail: "No minimum age set." };
      }
      if (!driver.dateOfBirth) {
        // Date of birth is optional on a profile, so this is unknown rather
        // than failed — an organizer can check a licence and sign it off.
        return {
          state: "needs_signoff",
          detail: "No date of birth on their profile.",
        };
      }
      const age = ageAt(driver.dateOfBirth, on);
      return age >= requirement.minAge
        ? { state: "met", detail: `${age} years old at the event.` }
        : {
            state: "not_met",
            detail: `${age} at the event, under the ${requirement.minAge} minimum.`,
          };
    }

    case "ACKNOWLEDGEMENT":
      // Nothing on a profile can prove a briefing was attended.
      return { state: "needs_signoff", detail: "Awaiting organizer sign-off." };
  }
}

/** Findings that stand in the way of confirming an entry. */
export function blockingFindings(
  findings: EligibilityFinding[],
): EligibilityFinding[] {
  return findings.filter(
    (finding) =>
      finding.enforcement === RequirementEnforcement.BLOCKING &&
      (finding.state === "not_met" ||
        finding.state === "needs_signoff" ||
        finding.state === "refused"),
  );
}

/** True when an entry satisfies every blocking requirement. */
export function isEntryEligible(findings: EligibilityFinding[]): boolean {
  return blockingFindings(findings).length === 0;
}

/** One-line summary for an entry row. */
export function summarizeEligibility(findings: EligibilityFinding[]): string {
  if (findings.length === 0) return "No requirements";
  const blocking = blockingFindings(findings);
  if (blocking.length === 0) return "All requirements met";
  const drivers = new Set(blocking.map((finding) => finding.driverName));
  return `${blocking.length} outstanding across ${drivers.size} driver${
    drivers.size === 1 ? "" : "s"
  }`;
}
