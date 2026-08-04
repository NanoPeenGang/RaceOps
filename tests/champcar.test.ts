import { describe, expect, it } from "vitest";
import { SeriesDiscipline, SeriesRuleKind, TrackKind } from "@prisma/client";
import {
  CHAMPCAR,
  CHAMPCAR_SOURCE,
  CHAMPCAR_TRACKS,
} from "../prisma/seed-data/champcar.mts";
import { US_REFERENCE_TRACKS } from "../prisma/seed-data/us-tracks.mts";
import { groupSeriesRules } from "@/lib/series-rules";

/**
 * The shipped ChampCar calendar is somebody else's published schedule, copied.
 * The failure that matters is not a crash — it is a date that drifted a year, a
 * round pointing at a circuit we do not carry, or a rule stated as fact with no
 * source behind it. All three ship silently and all three cost a competitor a
 * wasted tow. These are the review pass the data file never gets.
 */

const trackNames = new Set(
  [...US_REFERENCE_TRACKS, ...CHAMPCAR_TRACKS].map((track) => track.name),
);

describe("ChampCar reference series: shape", () => {
  it("is a real-world championship with a season and a source", () => {
    expect(CHAMPCAR.discipline).toBe(SeriesDiscipline.REAL_WORLD);
    expect(CHAMPCAR.season).toMatch(/^\d{4}$/);
    expect(CHAMPCAR.sourceUrl).toBe(CHAMPCAR_SOURCE);
    expect(CHAMPCAR.slug).toMatch(/^[a-z0-9-]+$/);
  });

  it("records when it was last checked, as a real date", () => {
    expect(CHAMPCAR.checkedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const checked = new Date(`${CHAMPCAR.checkedOn}T00:00:00Z`);
    expect(Number.isNaN(checked.getTime())).toBe(false);
    // A future date would suppress the staleness warning indefinitely.
    expect(checked.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("carries a full season of rounds", () => {
    // A partial calendar is worse than none: somebody plans around the gap.
    expect(CHAMPCAR.events.length).toBeGreaterThanOrEqual(12);
  });
});

describe("ChampCar reference series: calendar", () => {
  it("runs every round inside the stated season", () => {
    for (const round of CHAMPCAR.events) {
      expect(round.date.slice(0, 4), round.name).toBe(CHAMPCAR.season);
    }
  });

  it("uses well-formed dates that end no earlier than they start", () => {
    for (const round of CHAMPCAR.events) {
      expect(round.date, round.name).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      const start = new Date(`${round.date}T00:00:00`);
      expect(Number.isNaN(start.getTime()), round.name).toBe(false);

      if (!round.endDate) continue;
      expect(round.endDate, round.name).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      const end = new Date(`${round.endDate}T00:00:00`);
      expect(Number.isNaN(end.getTime()), round.name).toBe(false);
      expect(end.getTime(), round.name).toBeGreaterThanOrEqual(start.getTime());
      // A ChampCar round is a weekend, not a fortnight. A wildly long one is a
      // typo in the end date, which would block the calendar for months.
      const days = (end.getTime() - start.getTime()) / 86_400_000;
      expect(days, round.name).toBeLessThanOrEqual(6);
    }
  });

  it("is in calendar order", () => {
    const dates = CHAMPCAR.events.map((round) => round.date);
    expect(dates).toEqual([...dates].sort());
  });

  it("has no two rounds on the same day", () => {
    // Distinct from the duplicate check below: the series visits Sebring and
    // Harris Hill twice each in 2026, so the name repeats legitimately but the
    // date must not.
    const starts = CHAMPCAR.events.map((round) => round.date);
    expect(new Set(starts).size).toBe(starts.length);
  });

  it("has no round duplicated by name and date", () => {
    const keys = CHAMPCAR.events.map((round) => `${round.name}|${round.date}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("names a track the seed will actually find", () => {
    for (const round of CHAMPCAR.events) {
      expect(trackNames.has(round.trackName), round.trackName).toBe(true);
    }
  });

  it("names a layout the track actually has, when it names one", () => {
    // The loader deliberately leaves a round unlinked rather than substituting
    // the primary layout when a named configuration is missing — which is the
    // right behaviour, and exactly why nothing would tell us about a typo here.
    const layoutsByTrack = new Map(
      [...US_REFERENCE_TRACKS, ...CHAMPCAR_TRACKS].map((track) => [
        track.name,
        new Set(track.layouts.map((layout) => layout.name.toLowerCase())),
      ]),
    );
    for (const round of CHAMPCAR.events) {
      if (!round.layoutName) continue;
      const layouts = layoutsByTrack.get(round.trackName);
      expect(
        layouts?.has(round.layoutName.toLowerCase()),
        `${round.trackName} — ${round.layoutName}`,
      ).toBe(true);
    }
  });

  it("carries a free-text venue on every round, including linked ones", () => {
    // The venue is not a fallback for unlinked rounds only: it carries the town,
    // which a layout does not, and it is what survives if a layout is unlinked.
    for (const round of CHAMPCAR.events) {
      expect(round.venue.length, round.name).toBeGreaterThan(3);
      expect(round.venue, round.name).toContain(",");
      expect(round.format.length, round.name).toBeGreaterThan(3);
    }
  });

  it("explains itself wherever it declines to link a layout", () => {
    // `null` means "the series races a configuration we do not carry". Left
    // bare it reads as missing data, so the round has to say why.
    for (const round of CHAMPCAR.events) {
      if (round.layoutName !== null) continue;
      expect(round.description, round.name).toBeTruthy();
    }
  });
});

describe("ChampCar reference series: regulations", () => {
  it("cites a source for every rule", () => {
    // The whole justification for restating another organization's rule book is
    // that a reader can go check it. An uncited rule is just an assertion.
    for (const rule of CHAMPCAR.rules) {
      expect(rule.citation, rule.title).toBeTruthy();
      expect(rule.sourceUrl, rule.title).toMatch(/^https:\/\//);
      expect(rule.detail, rule.title).toBeTruthy();
    }
  });

  it("leads with the caveat that it is a summary", () => {
    // Ordering, not presence: a "read the actual rule book" note printed under
    // seven regulations somebody has already acted on is not a caveat.
    const first = groupSeriesRules(CHAMPCAR.rules)[0];
    expect(first?.kind).toBe(SeriesRuleKind.OTHER);
    expect(first?.rules[0]?.title.toLowerCase()).toContain("summary");
  });

  it("covers what decides a build and a crew", () => {
    const kinds = new Set(CHAMPCAR.rules.map((rule) => rule.kind));
    for (const required of [
      SeriesRuleKind.ELIGIBILITY,
      SeriesRuleKind.SAFETY,
      SeriesRuleKind.DRIVERS,
    ]) {
      expect(kinds.has(required), required).toBe(true);
    }
  });

  it("has no two rules sharing a title", () => {
    // The loader matches on title, so a duplicate would be silently dropped.
    const titles = CHAMPCAR.rules.map((rule) => rule.title);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it("orders rules distinctly within a kind", () => {
    const byKind = new Map<SeriesRuleKind, number[]>();
    for (const rule of CHAMPCAR.rules) {
      byKind.set(rule.kind, [...(byKind.get(rule.kind) ?? []), rule.sortOrder ?? 0]);
    }
    for (const [kind, orders] of byKind) {
      expect(new Set(orders).size, kind).toBe(orders.length);
    }
  });

  it("states no entry fee", () => {
    // Fees change between events and between revisions, and a stale one costs
    // somebody real money. They are deliberately not seeded.
    const text = CHAMPCAR.rules
      .map((rule) => `${rule.title} ${rule.detail ?? ""}`)
      .join(" ");
    expect(text).not.toMatch(/\$\d/);
  });
});

describe("ChampCar venues", () => {
  it("adds only circuits, with a town and a state", () => {
    for (const track of CHAMPCAR_TRACKS) {
      expect(track.kind, track.name).toBe(TrackKind.CIRCUIT);
      expect(track.city, track.name).toBeTruthy();
      expect(track.state, track.name).toMatch(/^[A-Z]{2}$/);
    }
  });

  it("does not duplicate a circuit the geographic directory already carries", () => {
    // These live apart from us-tracks.mts on purpose — they are here because a
    // seeded series races at them, not for state coverage. Adding one to both
    // would double it in the directory.
    const geographic = new Set(US_REFERENCE_TRACKS.map((track) => track.name));
    for (const track of CHAMPCAR_TRACKS) {
      expect(geographic.has(track.name), track.name).toBe(false);
    }
  });

  it("gives every circuit exactly one primary layout with a plausible length", () => {
    for (const track of CHAMPCAR_TRACKS) {
      const primary = track.layouts.filter((layout) => layout.isPrimary);
      expect(primary.length, track.name).toBe(1);
      for (const layout of track.layouts) {
        expect(layout.lengthMeters, `${track.name} — ${layout.name}`)
          .toBeGreaterThan(1000);
        expect(layout.lengthMeters, `${track.name} — ${layout.name}`)
          .toBeLessThan(9820);
      }
    }
  });
});
