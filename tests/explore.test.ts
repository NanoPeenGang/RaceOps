import { describe, expect, it } from "vitest";
import {
  appliedFilters,
  EMPTY_FILTERS,
  EXPLORE_TYPES,
  exploreHref,
  hasAnyFilter,
  MAX_PAGE,
  MIXED_PER_TYPE,
  PAGE_SIZE,
  parseFilters,
  soleType,
  toggleType,
  toQueryString,
  TYPE_LABELS,
  whenRange,
  withFilter,
  type ExploreFilters,
} from "@/lib/explore";
import { typesInPlay } from "@/server/trpc/routers/explore";

const parse = (query: string) => parseFilters(new URLSearchParams(query));

describe("the query string", () => {
  it("round-trips a full set of filters", () => {
    const filters: ExploreFilters = {
      q: "endurance",
      types: ["event", "series"],
      discipline: "REAL_WORLD",
      when: "upcoming",
      country: "US",
      region: "Georgia",
      seriesSlug: "champcar",
      trackKind: "CIRCUIT",
      page: 3,
    };
    expect(parse(toQueryString(filters))).toEqual(filters);
  });

  it("writes nothing for an empty search", () => {
    expect(toQueryString(EMPTY_FILTERS)).toBe("");
    expect(exploreHref(EMPTY_FILTERS)).toBe("/explore");
  });

  it("omits what is not set, so the URL stays readable", () => {
    expect(toQueryString(withFilter(EMPTY_FILTERS, { q: "vir" }))).toBe("q=vir");
  });

  it("canonicalises type order, so two spellings share a cache entry", () => {
    expect(parse("type=team,event").types).toEqual(["event", "team"]);
    expect(parse("type=event,team").types).toEqual(["event", "team"]);
  });

  it("drops a repeated type", () => {
    expect(parse("type=event,event").types).toEqual(["event"]);
  });

  it("ignores anything it does not recognise rather than failing", () => {
    /*
     * These URLs get hand-edited and pasted through chat clients that mangle
     * them. A filter page that throws on a stray parameter is worse than one
     * that ignores it.
     */
    const filters = parse("type=spaceship&when=someday&discipline=NASCAR&kind=MOON&page=-4");
    expect(filters.types).toEqual([]);
    expect(filters.when).toBeNull();
    expect(filters.discipline).toBeNull();
    expect(filters.trackKind).toBeNull();
    expect(filters.page).toBe(0);
  });

  it("survives junk in the page number", () => {
    for (const raw of ["", "abc", "NaN", "-1", "0", "  "]) {
      expect(parse(`page=${raw}`).page).toBe(0);
    }
  });

  it("clamps a hand-edited page rather than erroring on it", () => {
    /*
     * The router bounds what it will accept, so an unclamped page number here
     * would fail validation and blank the whole search instead of showing the
     * last page — the opposite of what somebody editing a URL expects.
     */
    expect(parse("page=999999999").page).toBe(MAX_PAGE);
    expect(parse(`page=${MAX_PAGE + 1}`).page).toBe(MAX_PAGE);
    expect(parse(`page=${MAX_PAGE}`).page).toBe(MAX_PAGE);
  });

  it("caps a pasted essay in the search box", () => {
    expect(parse(`q=${"x".repeat(500)}`).q).toHaveLength(120);
  });

  it("treats an empty string as absent, not as a filter", () => {
    const filters = parse("q=&region=&country=&series=");
    expect(hasAnyFilter(filters)).toBe(false);
  });
});

describe("changing a filter", () => {
  it("goes back to the first page", () => {
    // Otherwise a filter change lands somebody on page three of a result set
    // that now has eleven rows.
    const onPage3 = { ...EMPTY_FILTERS, page: 3 };
    expect(withFilter(onPage3, { region: "Georgia" }).page).toBe(0);
    expect(toggleType(onPage3, "team").page).toBe(0);
  });

  it("keeps a page number when the page is what changed", () => {
    expect(withFilter(EMPTY_FILTERS, { page: 2 }).page).toBe(2);
  });

  it("toggles a type on and back off", () => {
    const on = toggleType(EMPTY_FILTERS, "track");
    expect(on.types).toEqual(["track"]);
    expect(toggleType(on, "track").types).toEqual([]);
  });

  it("keeps canonical order however types are added", () => {
    const filters = toggleType(toggleType(EMPTY_FILTERS, "track"), "event");
    expect(filters.types).toEqual(["event", "track"]);
  });
});

describe("soleType", () => {
  it("is set only when exactly one type is chosen", () => {
    expect(soleType(EMPTY_FILTERS)).toBeNull();
    expect(soleType(withFilter(EMPTY_FILTERS, { types: ["team"] }))).toBe("team");
    expect(soleType(withFilter(EMPTY_FILTERS, { types: ["team", "event"] }))).toBeNull();
  });

  it("paginates further than a mixed search shows", () => {
    // The whole reason the two modes differ.
    expect(PAGE_SIZE).toBeGreaterThan(MIXED_PER_TYPE);
  });
});

describe("applied filters", () => {
  it("offers a way to remove every narrowing that is on", () => {
    /*
     * Every narrowing must be visible and every visible one removable. A facet
     * checked in a rail that has scrolled away is how somebody ends up staring
     * at an empty page convinced the search is broken.
     */
    const filters: ExploreFilters = {
      q: "x",
      types: ["event"],
      discipline: "SIM",
      when: "weekend",
      country: "US",
      region: "Georgia",
      seriesSlug: "champcar",
      trackKind: "OVAL",
      page: 0,
    };
    const chips = appliedFilters(filters);
    expect(chips).toHaveLength(7);
    for (const chip of chips) {
      expect(chip.label.length).toBeGreaterThan(0);
      // Removing one must actually change the filters.
      expect(chip.without).not.toEqual(filters);
    }
  });

  it("removes exactly one thing per chip", () => {
    const filters = withFilter(EMPTY_FILTERS, { region: "Georgia", when: "weekend" });
    const chips = appliedFilters(filters);
    const withoutRegion = chips.find((chip) => chip.label === "Georgia")!.without;
    expect(withoutRegion.region).toBeNull();
    expect(withoutRegion.when).toBe("weekend");
  });

  it("shows a series by name when the name is known", () => {
    const filters = withFilter(EMPTY_FILTERS, { seriesSlug: "champcar" });
    expect(appliedFilters(filters)[0]!.label).toBe("champcar");
    expect(appliedFilters(filters, { seriesName: "ChampCar" })[0]!.label).toBe("ChampCar");
  });

  it("labels every type", () => {
    for (const type of EXPLORE_TYPES) {
      expect(TYPE_LABELS[type].length).toBeGreaterThan(0);
    }
  });
});

describe("whenRange", () => {
  // Wednesday 2 September 2026.
  const wednesday = new Date("2026-09-02T14:00:00Z");

  it("means the coming Friday to Monday, from midweek", () => {
    const range = whenRange("weekend", wednesday);
    expect(range.from!.toISOString()).toBe("2026-09-04T00:00:00.000Z");
    expect(range.to!.toISOString()).toBe("2026-09-07T00:00:00.000Z");
  });

  it("means the weekend you are in, when you ask during it", () => {
    /*
     * The question at eight on a Saturday morning is "what is on", not "what
     * is on next week". Rolling forward here would answer the wrong one.
     */
    const saturday = new Date("2026-09-05T08:00:00Z");
    expect(whenRange("weekend", saturday).from!.toISOString()).toBe("2026-09-04T00:00:00.000Z");
  });

  it("still means this weekend on the Sunday", () => {
    const sunday = new Date("2026-09-06T20:00:00Z");
    const range = whenRange("weekend", sunday);
    expect(range.from!.toISOString()).toBe("2026-09-04T00:00:00.000Z");
    expect(range.to!.toISOString()).toBe("2026-09-07T00:00:00.000Z");
  });

  it("always spans exactly three days", () => {
    for (let day = 0; day < 14; day += 1) {
      const date = new Date(Date.UTC(2026, 8, 1 + day, 11));
      const range = whenRange("weekend", date);
      const days = (range.to!.getTime() - range.from!.getTime()) / 86_400_000;
      expect(days).toBe(3);
      // And it must always start on a Friday.
      expect(range.from!.getUTCDay()).toBe(5);
    }
  });

  it("counts thirty days forward from today", () => {
    const range = whenRange("upcoming", wednesday);
    expect(range.from!.toISOString()).toBe("2026-09-02T00:00:00.000Z");
    expect(range.to!.toISOString()).toBe("2026-10-02T00:00:00.000Z");
  });

  it("runs the season to the end of the calendar year", () => {
    expect(whenRange("season", wednesday).to!.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("looks only backwards for what has already run", () => {
    const range = whenRange("past", wednesday);
    expect(range.from).toBeUndefined();
    expect(range.to!.toISOString()).toBe("2026-09-02T00:00:00.000Z");
  });
});

describe("typesInPlay", () => {
  const base = { types: [], when: null, trackKind: null, discipline: null, seriesSlug: null };

  it("searches everything when nothing is narrowed", () => {
    expect(typesInPlay(base)).toEqual([...EXPLORE_TYPES]);
  });

  it("drops types a filter cannot possibly apply to", () => {
    /*
     * A track has no date and a team has no discipline. Returning zero of them
     * would leave somebody wondering whether the data is missing; dropping the
     * type lets the page say which filter excluded it instead.
     */
    expect(typesInPlay({ ...base, when: "weekend" })).toEqual(["event"]);
    expect(typesInPlay({ ...base, trackKind: "OVAL" })).toEqual(["track"]);
    expect(typesInPlay({ ...base, seriesSlug: "champcar" })).toEqual(["event"]);
    expect(typesInPlay({ ...base, discipline: "SIM" })).toEqual(["event", "series"]);
  });

  it("intersects rather than overriding an explicit choice", () => {
    expect(typesInPlay({ ...base, types: ["team", "event"], when: "weekend" })).toEqual(["event"]);
  });

  it("can end up with nothing, and says so honestly", () => {
    // Tracks that are also this weekend is not a thing; an empty list is the
    // correct answer and the caller renders "no matches", not a crash.
    expect(typesInPlay({ ...base, types: ["track"], when: "weekend" })).toEqual([]);
  });
});
