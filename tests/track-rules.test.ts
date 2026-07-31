import { describe, expect, it } from "vitest";
import { TrackRuleKind } from "@prisma/client";
import {
  groupRules,
  isStale,
  RULE_STALE_AFTER_DAYS,
  TRACK_RULE_DESCRIPTIONS,
  TRACK_RULE_LABELS,
  TRACK_RULE_ORDER,
  verifiedLabel,
} from "@/lib/track-rules";

const NOW = new Date(2026, 6, 31);

describe("rule kinds", () => {
  it("labels and describes every kind", () => {
    for (const kind of Object.values(TrackRuleKind)) {
      expect(TRACK_RULE_LABELS[kind], kind).toBeTruthy();
      expect(TRACK_RULE_DESCRIPTIONS[kind], kind).toBeTruthy();
    }
  });

  it("orders every kind exactly once", () => {
    expect([...TRACK_RULE_ORDER].sort()).toEqual(
      Object.values(TrackRuleKind).sort(),
    );
  });

  it("leads with what stops you racing", () => {
    // Somebody skimming a track page the night before a tow needs the sound
    // limit and the curfew first, not an alphabetical list starting at Access.
    expect(TRACK_RULE_ORDER[0]).toBe(TrackRuleKind.SOUND);
    expect(TRACK_RULE_ORDER[1]).toBe(TrackRuleKind.CURFEW);
    expect(TRACK_RULE_ORDER.at(-1)).toBe(TrackRuleKind.OTHER);
  });
});

describe("groupRules", () => {
  const rule = (kind: TrackRuleKind, title: string) => ({ kind, title });

  it("groups in display order, not input order", () => {
    const groups = groupRules([
      rule(TrackRuleKind.PADDOCK, "No open flame"),
      rule(TrackRuleKind.SOUND, "103 dBA"),
      rule(TrackRuleKind.CURFEW, "No Sundays"),
    ]);
    expect(groups.map((g) => g.kind)).toEqual([
      TrackRuleKind.SOUND,
      TrackRuleKind.CURFEW,
      TrackRuleKind.PADDOCK,
    ]);
  });

  it("keeps several rules of one kind together", () => {
    const groups = groupRules([
      rule(TrackRuleKind.CURFEW, "No Sundays"),
      rule(TrackRuleKind.CURFEW, "09:00–18:00"),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].rules.map((r) => r.title)).toEqual([
      "No Sundays",
      "09:00–18:00",
    ]);
  });

  it("drops empty kinds", () => {
    // Eight headings with six of them empty makes a track with two recorded
    // rules look like a track with six missing ones.
    const groups = groupRules([rule(TrackRuleKind.SOUND, "86 dBA")]);
    expect(groups).toHaveLength(1);
    expect(groupRules([])).toEqual([]);
  });
});

describe("isStale", () => {
  it("flags a rule nobody has checked in over a season", () => {
    const old = new Date(NOW);
    old.setDate(old.getDate() - RULE_STALE_AFTER_DAYS - 1);
    expect(isStale(old, NOW)).toBe(true);
  });

  it("leaves a recently checked rule alone", () => {
    const recent = new Date(NOW);
    recent.setDate(recent.getDate() - 30);
    expect(isStale(recent, NOW)).toBe(false);
  });

  it("does not call an unverified rule stale", () => {
    // Never checked and checked-long-ago are different states, and the UI
    // says them differently. Conflating them tells somebody a brand-new
    // entry is out of date.
    expect(isStale(null, NOW)).toBe(false);
    expect(isStale(undefined, NOW)).toBe(false);
  });

  it("survives a value that is not a date", () => {
    expect(isStale("not a date", NOW)).toBe(false);
  });

  it("accepts an ISO string, which is what comes over the wire", () => {
    expect(isStale("2020-01-01", NOW)).toBe(true);
    expect(isStale("2026-07-01", NOW)).toBe(false);
  });
});

describe("verifiedLabel", () => {
  it("reads to month precision", () => {
    expect(verifiedLabel(new Date(2026, 2, 14))).toBe("Checked March 2026");
  });

  it("is explicit about never having been checked", () => {
    expect(verifiedLabel(null)).toBe("Not verified");
    expect(verifiedLabel("rubbish")).toBe("Not verified");
  });
});
