import { describe, expect, it } from "vitest";
import { SeriesRuleKind } from "@prisma/client";
import {
  SERIES_RULE_DESCRIPTIONS,
  SERIES_RULE_LABELS,
  SERIES_RULE_ORDER,
  groupSeriesRules,
} from "@/lib/series-rules";

const rule = (
  kind: SeriesRuleKind,
  title: string,
  sortOrder?: number,
): { kind: SeriesRuleKind; title: string; sortOrder?: number } => ({
  kind,
  title,
  ...(sortOrder === undefined ? {} : { sortOrder }),
});

describe("series rule vocabulary", () => {
  it("labels and describes every kind the schema can hold", () => {
    // A kind added to the enum without a label renders as blank rather than
    // failing, so the omission would ship.
    for (const kind of Object.values(SeriesRuleKind)) {
      expect(SERIES_RULE_LABELS[kind], kind).toBeTruthy();
      expect(SERIES_RULE_DESCRIPTIONS[kind], kind).toBeTruthy();
    }
  });

  it("orders every kind exactly once", () => {
    expect([...SERIES_RULE_ORDER].sort()).toEqual(
      Object.values(SeriesRuleKind).sort(),
    );
  });

  it("puts the provenance caveat before the regulations it qualifies", () => {
    expect(SERIES_RULE_ORDER[0]).toBe(SeriesRuleKind.OTHER);
  });
});

describe("groupSeriesRules", () => {
  it("drops kinds with nothing in them", () => {
    const groups = groupSeriesRules([rule(SeriesRuleKind.SAFETY, "Cage")]);
    expect(groups.map((group) => group.kind)).toEqual([SeriesRuleKind.SAFETY]);
  });

  it("returns groups in display order, not input order", () => {
    const groups = groupSeriesRules([
      rule(SeriesRuleKind.SCORING, "Points"),
      rule(SeriesRuleKind.ELIGIBILITY, "Cap"),
      rule(SeriesRuleKind.OTHER, "Summary"),
    ]);
    expect(groups.map((group) => group.kind)).toEqual([
      SeriesRuleKind.OTHER,
      SeriesRuleKind.ELIGIBILITY,
      SeriesRuleKind.SCORING,
    ]);
  });

  it("sorts within a kind by sortOrder, so a cap precedes its penalty", () => {
    const groups = groupSeriesRules([
      rule(SeriesRuleKind.ELIGIBILITY, "Penalty laps for exceeding it", 2),
      rule(SeriesRuleKind.ELIGIBILITY, "Points cap is 500", 1),
    ]);
    expect(groups[0]?.rules.map((r) => r.title)).toEqual([
      "Points cap is 500",
      "Penalty laps for exceeding it",
    ]);
  });

  it("treats a missing sortOrder as first rather than dropping the rule", () => {
    const groups = groupSeriesRules([
      rule(SeriesRuleKind.DRIVERS, "Numbered", 1),
      rule(SeriesRuleKind.DRIVERS, "Unnumbered"),
    ]);
    expect(groups[0]?.rules.map((r) => r.title)).toEqual([
      "Unnumbered",
      "Numbered",
    ]);
  });

  it("is empty for no rules, so the page can hide the section", () => {
    expect(groupSeriesRules([])).toEqual([]);
  });
});
