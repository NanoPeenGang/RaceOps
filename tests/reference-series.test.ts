import { describe, expect, it } from "vitest";
import { SeriesDiscipline, SeriesRuleKind } from "@prisma/client";
import { REFERENCE_SERIES } from "../prisma/seed-data/seed-series.mts";
import { LEMONS, LEMONS_SOURCE } from "../prisma/seed-data/lemons.mts";
import { groupSeriesRules } from "@/lib/series-rules";

/**
 * Invariants every shipped championship has to hold.
 *
 * These were written against ChampCar and lived in its own test file, which
 * meant the second series inherited none of them. They are about the *shape*
 * of a reference series — cited rules, a check date, titles the loader can
 * match on — so they belong here, run over whatever is in `REFERENCE_SERIES`.
 */

describe.each(REFERENCE_SERIES.map((series) => [series.name, series] as const))(
  "%s: shape",
  (_name, series) => {
    it("is a championship with a slug, a season and a source", () => {
      expect(series.slug).toMatch(/^[a-z0-9-]+$/);
      expect(series.season).toMatch(/^\d{4}$/);
      expect(series.sourceUrl).toMatch(/^https:\/\//);
      expect(series.name.length).toBeGreaterThan(2);
      expect(series.description.length).toBeGreaterThan(80);
    });

    it("records when it was last checked, as a date that has happened", () => {
      // A future date would suppress the staleness warning indefinitely.
      expect(series.checkedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      const checked = new Date(`${series.checkedOn}T00:00:00Z`);
      expect(Number.isNaN(checked.getTime())).toBe(false);
      expect(checked.getTime()).toBeLessThanOrEqual(Date.now());
    });

    it("cites a source for every rule", () => {
      // The whole justification for restating somebody else's rule book is
      // that a reader can go and check it. An uncited rule is an assertion.
      for (const rule of series.rules) {
        expect(rule.citation, rule.title).toBeTruthy();
        expect(rule.sourceUrl, rule.title).toMatch(/^https:\/\//);
        expect(rule.detail, rule.title).toBeTruthy();
      }
    });

    it("has no two rules sharing a title", () => {
      // The loader matches on title, so a duplicate is silently dropped.
      const titles = series.rules.map((rule) => rule.title);
      expect(new Set(titles).size).toBe(titles.length);
    });

    it("orders rules distinctly within a kind", () => {
      const byKind = new Map<SeriesRuleKind, number[]>();
      for (const rule of series.rules) {
        byKind.set(rule.kind, [
          ...(byKind.get(rule.kind) ?? []),
          rule.sortOrder ?? 0,
        ]);
      }
      for (const [kind, orders] of byKind) {
        expect(new Set(orders).size, `${series.name} ${kind}`).toBe(
          orders.length,
        );
      }
    });

    it("leads with the caveat that it is a summary", () => {
      // A "read the actual rule book" note printed under a dozen regulations
      // somebody has already acted on is not a caveat.
      const first = groupSeriesRules(series.rules)[0];
      expect(first?.kind).toBe(SeriesRuleKind.OTHER);
      expect(first?.rules[0]?.title.toLowerCase()).toContain("summary");
    });

    it("keeps every round inside the stated season, in calendar order", () => {
      // Vacuous for a series with no calendar, which is a supported shape.
      const dates = series.events.map((round) => round.date);
      expect(dates).toEqual([...dates].sort());
      for (const round of series.events) {
        expect(round.date.slice(0, 4), round.name).toBe(series.season);
      }
    });
  },
);

describe("reference series: the set", () => {
  it("has no two series sharing a slug", () => {
    const slugs = REFERENCE_SERIES.map((series) => series.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("ships more than one, so the loader is exercised over a list", () => {
    expect(REFERENCE_SERIES.length).toBeGreaterThan(1);
  });
});

describe("24 Hours of Lemons: the rules people come for", () => {
  const titles = LEMONS.rules.map((rule) => rule.title).join(" | ");
  const text = LEMONS.rules
    .map((rule) => `${rule.title} ${rule.detail ?? ""}`)
    .join(" ");

  it("is a real-world championship pointed at the right site", () => {
    expect(LEMONS.discipline).toBe(SeriesDiscipline.REAL_WORLD);
    expect(LEMONS.sourceUrl).toBe(LEMONS_SOURCE);
  });

  it("states the $500 limit and that safety gear is outside it", () => {
    expect(titles).toContain("$500");
    expect(text).toMatch(/save the \*?driver\*?/);
  });

  it("lists what the budget does not count, including the turbo trap", () => {
    // The exemptions are the half of the rule people get wrong: brakes and
    // tyres are free, the turbo bolted to the exempt exhaust is not.
    expect(text).toContain("Wheels, tyres");
    expect(text).toMatch(/turbocharger/i);
    expect(text).toMatch(/not\* exempt|not exempt/);
  });

  it("explains the penalty rather than implying disqualification", () => {
    // Going over the cap does not put you out — it starts you laps down.
    expect(text).toMatch(/one lap per \$10|\$10 over/);
    expect(text).not.toMatch(/disqualif/i);
  });

  it("covers eligibility, safety, drivers, format, scoring and conduct", () => {
    const kinds = new Set(LEMONS.rules.map((rule) => rule.kind));
    for (const required of [
      SeriesRuleKind.ELIGIBILITY,
      SeriesRuleKind.SAFETY,
      SeriesRuleKind.DRIVERS,
      SeriesRuleKind.FORMAT,
      SeriesRuleKind.SCORING,
      SeriesRuleKind.CONDUCT,
      SeriesRuleKind.ENTRY,
    ]) {
      expect(kinds.has(required), required).toBe(true);
    }
  });

  it("splits the safety rules into what the car needs and what the driver wears", () => {
    // They are bought at different times from different places, and a single
    // merged rule is one nobody can check a build against.
    const safety = LEMONS.rules.filter(
      (rule) => rule.kind === SeriesRuleKind.SAFETY,
    );
    expect(safety).toHaveLength(2);
    expect(safety.some((rule) => /cage/i.test(rule.detail ?? ""))).toBe(true);
    expect(safety.some((rule) => /helmet/i.test(rule.detail ?? ""))).toBe(true);
  });

  it("tells people to re-check the helmet rating rather than trusting this", () => {
    // Snell and SFI ratings roll on a cycle; a seeded spec goes stale and
    // somebody buys the wrong helmet on our word.
    const kit = LEMONS.rules.find((rule) => /Driver kit/.test(rule.title));
    expect(kit?.detail).toMatch(/check the current/i);
  });

  it("states no entry fee", () => {
    // Fees change between events and seasons, and a stale one costs money.
    // The dollar figures that *are* here are the budget cap and its penalty.
    expect(text).not.toMatch(/entry fee|per car|registration costs/i);
  });

  it("does not present the People's Curse as a current rule", () => {
    // The series' most famous piece of folklore, dropped in 2013. Listing it
    // among live regulations would be repeating a story as a rule.
    expect(text).not.toMatch(/People's Curse/i);
  });

  it("carries no calendar, and says so where somebody would look for one", () => {
    // Lemons runs over twenty rounds a year and the schedule could not be
    // verified. Two corroborated rounds would read as the season.
    expect(LEMONS.events).toEqual([]);
    expect(LEMONS.description).toMatch(/calendar is not seeded/i);
  });
});
