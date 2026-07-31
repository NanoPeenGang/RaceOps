import { TrackRuleKind } from "@prisma/client";

/**
 * Facility rules, as distinct from sporting regulations.
 *
 * The ordering below is the order they appear on a track page, and it is not
 * alphabetical: it runs from "this will stop you leaving home" to "this will
 * mildly annoy you in the paddock". Somebody skimming a track page the night
 * before a tow needs the sound limit and the curfew first.
 */

export const TRACK_RULE_LABELS: Record<TrackRuleKind, string> = {
  SOUND: "Sound",
  CURFEW: "Hours & curfew",
  LICENCE: "Licence & eligibility",
  SAFETY: "Safety equipment",
  PADDOCK: "Paddock",
  ENVIRONMENTAL: "Environmental",
  ACCESS: "Access",
  OTHER: "Other",
};

export const TRACK_RULE_DESCRIPTIONS: Record<TrackRuleKind, string> = {
  SOUND:
    "Noise limits and how they are measured. The most common reason a car is turned away at the gate.",
  CURFEW:
    "When the circuit may run, quiet days, and days of use permitted per year.",
  LICENCE: "Competition licence, novice restrictions, minimum age.",
  SAFETY: "Equipment the facility requires beyond the series regulations.",
  PADDOCK: "Camping, generators, open flame, awnings, tyre storage.",
  ENVIRONMENTAL: "Fuel handling, spill kits, tyre and fluid disposal.",
  ACCESS: "Gate times, minors, animals, spectator areas.",
  OTHER: "Anything else the facility imposes.",
};

/** Display order — most likely to stop you racing, first. */
export const TRACK_RULE_ORDER: readonly TrackRuleKind[] = [
  TrackRuleKind.SOUND,
  TrackRuleKind.CURFEW,
  TrackRuleKind.LICENCE,
  TrackRuleKind.SAFETY,
  TrackRuleKind.PADDOCK,
  TrackRuleKind.ENVIRONMENTAL,
  TrackRuleKind.ACCESS,
  TrackRuleKind.OTHER,
];

export interface RuleLike {
  kind: TrackRuleKind;
  title: string;
}

/**
 * Groups rules for display, in `TRACK_RULE_ORDER`, dropping empty kinds.
 *
 * Showing all eight headings with six of them empty makes a track with two
 * recorded rules look like a track with six missing ones.
 */
export function groupRules<T extends RuleLike>(
  rules: readonly T[],
): { kind: TrackRuleKind; rules: T[] }[] {
  return TRACK_RULE_ORDER.map((kind) => ({
    kind,
    rules: rules.filter((rule) => rule.kind === kind),
  })).filter((group) => group.rules.length > 0);
}

/**
 * How stale a rule is allowed to get before the page flags it.
 *
 * A season. Facility rules are renegotiated with the county, the neighbours
 * and the insurer over a winter, so a limit last checked two summers ago is a
 * limit worth re-checking before loading the trailer.
 */
export const RULE_STALE_AFTER_DAYS = 400;

/**
 * Whether to warn that a rule may be out of date.
 *
 * Never verified is *not* stale — it is unverified, which the UI says
 * differently. Conflating them would tell somebody a brand-new entry is old.
 */
export function isStale(
  verifiedOn: Date | string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!verifiedOn) return false;
  const checked = new Date(verifiedOn);
  if (Number.isNaN(checked.getTime())) return false;
  const days = (now.getTime() - checked.getTime()) / 86_400_000;
  return days > RULE_STALE_AFTER_DAYS;
}

/** "Checked March 2026" — month precision, because the day is false comfort. */
export function verifiedLabel(
  verifiedOn: Date | string | null | undefined,
): string {
  if (!verifiedOn) return "Not verified";
  const checked = new Date(verifiedOn);
  if (Number.isNaN(checked.getTime())) return "Not verified";
  return `Checked ${checked.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  })}`;
}
