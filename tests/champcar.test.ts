import { describe, expect, it } from "vitest";
import { SeriesRuleKind, TrackKind } from "@prisma/client";
import { CHAMPCAR, CHAMPCAR_TRACKS } from "../prisma/seed-data/champcar.mts";
import { US_REFERENCE_TRACKS } from "../prisma/seed-data/us-tracks.mts";

/**
 * The shipped ChampCar calendar is somebody else's published schedule, copied.
 * The failure that matters is not a crash — it is a date that drifted a year, a
 * round pointing at a circuit we do not carry, or a rule stated as fact with no
 * source behind it. All three ship silently and all three cost a competitor a
 * wasted tow. These are the review pass the data file never gets.
 *
 * Invariants that hold for *every* shipped series — cited rules, a check date,
 * unique titles — live in `reference-series.test.ts` and run over all of them.
 * What is here is specific to this calendar.
 */

const trackNames = new Set(
  [...US_REFERENCE_TRACKS, ...CHAMPCAR_TRACKS].map((track) => track.name),
);

describe("ChampCar reference series: calendar", () => {
  it("carries a full season of rounds", () => {
    // A partial calendar is worse than none: somebody plans around the gap.
    // Lemons ships with none at all rather than a partial one, for the same
    // reason — see `lemons.mts`.
    expect(CHAMPCAR.events.length).toBeGreaterThanOrEqual(12);
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
