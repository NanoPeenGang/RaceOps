import { describe, expect, it } from "vitest";
import { TrackKind } from "@prisma/client";
import {
  STATES_WITHOUT_TRACKS,
  US_REFERENCE_TRACKS,
} from "../prisma/seed-data/us-tracks.mts";
import { referenceSlug } from "../prisma/seed-data/seed-tracks.mts";

/**
 * The shipped track directory is data, not code, so the interesting failures
 * are typos: a duplicated venue, a length that is out by a factor of a
 * thousand, a state that quietly lost its entries during an edit. None of
 * those break a build; all of them are visible to every organizer on the
 * platform. These assertions are the review pass a data file never gets.
 */

const LOWER_48 = [
  "AL", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "ID",
  "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI",
  "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY",
  "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN",
  "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
];

const byState = new Map<string, typeof US_REFERENCE_TRACKS>();
for (const track of US_REFERENCE_TRACKS) {
  byState.set(track.state, [...(byState.get(track.state) ?? []), track]);
}

describe("US reference tracks: coverage", () => {
  it("covers all 48 contiguous states, or says why not", () => {
    const missing = LOWER_48.filter((state) => !byState.has(state));
    expect(missing).toEqual([...STATES_WITHOUT_TRACKS]);
  });

  it("carries two to five tracks in every state it covers", () => {
    // Fewer than two is a gap; more than five is a directory, not a starting
    // point — people should be adding their local circuits, not scrolling past
    // ours to find them.
    const wrong = [...byState.entries()]
      .filter(([, tracks]) => tracks.length < 2 || tracks.length > 5)
      .map(([state, tracks]) => `${state}=${tracks.length}`);
    expect(wrong).toEqual([]);
  });

  it("does not claim a state it also lists as empty", () => {
    for (const state of STATES_WITHOUT_TRACKS) {
      expect(byState.has(state)).toBe(false);
    }
  });

  it("stays inside the lower 48", () => {
    const outside = [...byState.keys()].filter(
      (state) => !LOWER_48.includes(state),
    );
    expect(outside).toEqual([]);
  });

  it("is only circuits and ovals, as briefed", () => {
    const kinds = new Set(US_REFERENCE_TRACKS.map((track) => track.kind));
    expect([...kinds].sort()).toEqual([TrackKind.CIRCUIT, TrackKind.OVAL]);
  });

  it("includes road racing in every region, not just ovals", () => {
    // A directory that is 100% ovals would be useless to the road racing
    // clubs that make up most of RaceOps' likely early users.
    const circuits = US_REFERENCE_TRACKS.filter(
      (track) => track.kind === TrackKind.CIRCUIT,
    );
    expect(circuits.length).toBeGreaterThanOrEqual(40);
  });
});

describe("US reference tracks: identity", () => {
  it("has no two tracks with the same name in the same state", () => {
    const seen = new Set<string>();
    const clashes: string[] = [];
    for (const track of US_REFERENCE_TRACKS) {
      const key = `${track.state}/${track.name.toLowerCase()}`;
      if (seen.has(key)) clashes.push(key);
      seen.add(key);
    }
    expect(clashes).toEqual([]);
  });

  it("produces a distinct, non-empty slug for every track", () => {
    const slugs = US_REFERENCE_TRACKS.map(referenceSlug);
    expect(slugs.filter((slug) => slug.length === 0)).toEqual([]);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("keeps slugs inside the column's 80-character budget", () => {
    const long = US_REFERENCE_TRACKS.map(referenceSlug).filter(
      (slug) => slug.length > 80,
    );
    expect(long).toEqual([]);
  });

  it("gives every track a name, a city and a state", () => {
    for (const track of US_REFERENCE_TRACKS) {
      expect(track.name.trim(), track.name).toBe(track.name);
      expect(track.name.length, track.name).toBeGreaterThan(2);
      expect(track.city.length, track.name).toBeGreaterThan(1);
      expect(track.state, track.name).toMatch(/^[A-Z]{2}$/);
    }
  });
});

describe("US reference tracks: layouts", () => {
  it("gives every track at least one layout", () => {
    const bare = US_REFERENCE_TRACKS.filter(
      (track) => track.layouts.length === 0,
    );
    expect(bare.map((track) => track.name)).toEqual([]);
  });

  it("marks exactly one layout primary per track", () => {
    // Events default to the primary layout. Zero leaves the picker blank;
    // two makes which one you get depend on row order.
    const wrong = US_REFERENCE_TRACKS.filter(
      (track) => track.layouts.filter((layout) => layout.isPrimary).length !== 1,
    );
    expect(wrong.map((track) => track.name)).toEqual([]);
  });

  it("has no two layouts sharing a name on one track", () => {
    // TrackLayout is unique on [trackId, name]; a duplicate here would make
    // the seed throw halfway through.
    for (const track of US_REFERENCE_TRACKS) {
      const names = track.layouts.map((layout) => layout.name);
      expect(new Set(names).size, track.name).toBe(names.length);
    }
  });

  it("keeps every stated length physically plausible", () => {
    // 0.2 miles is about the shortest quarter-midget bullring anyone races on.
    // The ceiling is set by Spring Mountain's 6.1-mile full course, the
    // longest road course in North America — anything past that is a typo.
    for (const track of US_REFERENCE_TRACKS) {
      for (const layout of track.layouts) {
        if (layout.lengthMeters === undefined) continue;
        const label = `${track.name} — ${layout.name}`;
        expect(layout.lengthMeters, label).toBeGreaterThanOrEqual(320);
        expect(layout.lengthMeters, label).toBeLessThanOrEqual(9820);
        expect(Number.isInteger(layout.lengthMeters), label).toBe(true);
      }
    }
  });

  it("keeps ovals short and circuits long, which is what tells them apart", () => {
    for (const track of US_REFERENCE_TRACKS) {
      const primary = track.layouts.find((layout) => layout.isPrimary);
      if (!primary?.lengthMeters) continue;
      // Superspeedways reach 2.66 miles; road courses start around a mile.
      const limit = track.kind === TrackKind.OVAL ? 4300 : 1400;
      const label = `${track.name} — ${primary.name}`;
      if (track.kind === TrackKind.OVAL) {
        expect(primary.lengthMeters, label).toBeLessThanOrEqual(limit);
      } else {
        expect(primary.lengthMeters, label).toBeGreaterThanOrEqual(limit);
      }
    }
  });

  it("gives most tracks a length, so the directory is actually useful", () => {
    const withLength = US_REFERENCE_TRACKS.filter((track) =>
      track.layouts.some((layout) => layout.lengthMeters !== undefined),
    );
    expect(withLength.length / US_REFERENCE_TRACKS.length).toBeGreaterThan(0.9);
  });
});
