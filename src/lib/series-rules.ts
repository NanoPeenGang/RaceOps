import { SeriesRuleKind } from "@prisma/client";

/**
 * Sporting regulations, as distinct from facility rules.
 *
 * Where `track-rules.ts` orders by "what will stop you leaving home", these are
 * ordered by what you have to decide first. Eligibility comes before everything
 * because it decides which car you build; safety next because it is most of the
 * budget; drivers next because it decides how many people you need on the team.
 * Scoring and conduct matter once you are already entered.
 */

export const SERIES_RULE_LABELS: Record<SeriesRuleKind, string> = {
  ELIGIBILITY: "Car eligibility",
  SAFETY: "Safety equipment",
  DRIVERS: "Drivers & stints",
  FORMAT: "Race format",
  SCORING: "Scoring",
  CONDUCT: "On-track conduct",
  ENTRY: "Entry & registration",
  OTHER: "Before you rely on any of this",
};

export const SERIES_RULE_DESCRIPTIONS: Record<SeriesRuleKind, string> = {
  ELIGIBILITY:
    "What may be entered, and how the series values a car. Decides the build.",
  SAFETY: "Cage, seat, restraints, fire, electrical. Usually most of the cost.",
  DRIVERS: "How many drivers a race needs, and how long each may stay in.",
  FORMAT: "Race length, sessions, and how a weekend runs.",
  SCORING: "How results become championship points.",
  CONDUCT: "Contact, flags, and what the stewards will act on.",
  ENTRY: "Registration, deadlines, and what an entry includes.",
  OTHER: "Scope and provenance of the summary on this page.",
};

/**
 * Display order.
 *
 * `OTHER` leads rather than trails, which is the opposite of every other list
 * in this codebase and is deliberate: for a reference series it holds the
 * "this is a summary, read the rule book" entry, and a caveat printed under
 * seven regulations somebody has already acted on is not a caveat.
 */
export const SERIES_RULE_ORDER: readonly SeriesRuleKind[] = [
  SeriesRuleKind.OTHER,
  SeriesRuleKind.ELIGIBILITY,
  SeriesRuleKind.SAFETY,
  SeriesRuleKind.DRIVERS,
  SeriesRuleKind.FORMAT,
  SeriesRuleKind.ENTRY,
  SeriesRuleKind.SCORING,
  SeriesRuleKind.CONDUCT,
];

export interface SeriesRuleLike {
  kind: SeriesRuleKind;
  title: string;
  sortOrder?: number;
}

/**
 * Groups regulations for display, in `SERIES_RULE_ORDER`, dropping empty kinds.
 *
 * Within a kind, `sortOrder` wins over the order rows came back in: the seed
 * numbers them so "the points cap is 500" precedes "here is the penalty for
 * exceeding it", and alphabetical or insertion order would invert that.
 */
export function groupSeriesRules<T extends SeriesRuleLike>(
  rules: readonly T[],
): { kind: SeriesRuleKind; rules: T[] }[] {
  return SERIES_RULE_ORDER.map((kind) => ({
    kind,
    rules: rules
      .filter((rule) => rule.kind === kind)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)),
  })).filter((group) => group.rules.length > 0);
}
