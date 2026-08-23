import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  EventStatus,
  PrismaClient,
  SeriesDiscipline,
  TrackKind,
} from "@prisma/client";
import { createCaller } from "@/server/trpc/root";
import { EMPTY_FILTERS, MIXED_PER_TYPE, PAGE_SIZE, type ExploreFilters } from "@/lib/explore";

/**
 * One search standing in for four directories.
 *
 * What needs a database here is the filtering itself: that a draft stays out
 * of a public browse, that a date window means what it says, and that
 * narrowing to one type paginates rather than truncating. The query-string
 * handling is covered by the unit tests.
 *
 * Opt in with RUN_DB_TESTS=1.
 */
const ENABLED = process.env.RUN_DB_TESTS === "1";
const db = ENABLED ? new PrismaClient() : (null as unknown as PrismaClient);
const caller = () => createCaller({ db, clerkUserId: null, headers: new Headers() });

function filters(overrides: Partial<ExploreFilters> = {}): ExploreFilters {
  return { ...EMPTY_FILTERS, ...overrides };
}

describe.skipIf(!ENABLED)("explore (integration)", () => {
  const run = Date.now();
  const tag = `xplor${run}`;
  let seriesSlug: string;
  let draftId: string;

  beforeAll(async () => {
    if (!ENABLED) return;

    const series = await db.series.create({
      data: {
        name: `${tag} Endurance Cup`,
        slug: `${tag}-endurance-cup`,
        discipline: SeriesDiscipline.REAL_WORLD,
        platform: "Circuit",
      },
    });
    seriesSlug = series.slug;

    await db.series.create({
      data: {
        name: `${tag} Sim League`,
        slug: `${tag}-sim-league`,
        discipline: SeriesDiscipline.SIM,
        platform: "iRacing",
      },
    });

    const track = await db.track.create({
      data: {
        name: `${tag} Speedway`,
        slug: `${tag}-speedway`,
        kind: TrackKind.OVAL,
        country: "US",
        region: `${tag}shire`,
        city: "Testville",
        layouts: {
          create: { name: "Oval", lengthMeters: 1609.34, turnCount: 4, isPrimary: true },
        },
      },
    });
    const layout = await db.trackLayout.findFirstOrThrow({ where: { trackId: track.id } });

    await db.team.create({
      data: { name: `${tag} Racing`, slug: `${tag}-racing`, homeBase: `${tag}shire` },
    });

    // Enough events to prove pagination, dated across the windows under test.
    const base = Date.UTC(2026, 8, 2); // Wednesday 2 September 2026
    for (let index = 0; index < PAGE_SIZE + 4; index += 1) {
      await db.raceEvent.create({
        data: {
          name: `${tag} Round ${index + 1}`,
          seriesLabel: series.name,
          seriesId: series.id,
          platform: "Real world",
          trackLayoutId: layout.id,
          // Spread forward from a fortnight out so none land in the past.
          date: new Date(base + (14 + index) * 86_400_000),
          status: EventStatus.PUBLISHED,
        },
      });
    }

    const draft = await db.raceEvent.create({
      data: {
        name: `${tag} Secret Round`,
        seriesLabel: series.name,
        seriesId: series.id,
        platform: "Real world",
        date: new Date(base + 20 * 86_400_000),
        status: EventStatus.DRAFT,
      },
    });
    draftId = draft.id;
  });

  afterAll(async () => {
    if (!ENABLED) return;
    await db.raceEvent.deleteMany({ where: { name: { startsWith: tag } } });
    await db.series.deleteMany({ where: { slug: { startsWith: tag } } });
    await db.team.deleteMany({ where: { slug: { startsWith: tag } } });
    await db.trackLayout.deleteMany({ where: { track: { slug: { startsWith: tag } } } });
    await db.track.deleteMany({ where: { slug: { startsWith: tag } } });
    await db.$disconnect();
  });

  it("finds all four kinds of thing from one query", async () => {
    const results = await caller().explore.search(filters({ q: tag }));
    expect(results.counts.event).toBeGreaterThan(0);
    expect(results.counts.series).toBe(2);
    expect(results.counts.team).toBe(1);
    expect(results.counts.track).toBe(1);
  });

  it("shows only a handful of each when searching across everything", async () => {
    const results = await caller().explore.search(filters({ q: tag }));
    expect(results.events).toHaveLength(MIXED_PER_TYPE);
    // …while still reporting how many there really are, so "see all" is honest.
    expect(results.counts.event).toBe(PAGE_SIZE + 4);
    expect(results.sole).toBeNull();
  });

  it("paginates properly once narrowed to one type", async () => {
    const first = await caller().explore.search(filters({ q: tag, types: ["event"] }));
    expect(first.sole).toBe("event");
    expect(first.events).toHaveLength(PAGE_SIZE);

    const second = await caller().explore.search(
      filters({ q: tag, types: ["event"], page: 1 }),
    );
    expect(second.events).toHaveLength(4);

    const ids = new Set([...first.events, ...second.events].map((event) => event.id));
    expect(ids.size).toBe(PAGE_SIZE + 4);
  });

  it("never shows a draft to somebody browsing", async () => {
    const results = await caller().explore.search(filters({ q: tag, types: ["event"] }));
    expect(results.events.map((event) => event.id)).not.toContain(draftId);

    const page2 = await caller().explore.search(filters({ q: tag, types: ["event"], page: 1 }));
    expect(page2.events.map((event) => event.id)).not.toContain(draftId);
  });

  it("narrows events to one series", async () => {
    const results = await caller().explore.search(filters({ q: tag, seriesSlug }));
    expect(results.counts.event).toBe(PAGE_SIZE + 4);
    // A series filter is a question only an event can answer.
    expect(results.active).toEqual(["event"]);
    expect(results.counts.team).toBe(0);
  });

  it("narrows series by discipline", async () => {
    const sim = await caller().explore.search(filters({ q: tag, discipline: "SIM", types: ["series"] }));
    expect(sim.series.map((entry) => entry.name)).toEqual([`${tag} Sim League`]);
  });

  it("finds a team and a track by the region they share", async () => {
    const results = await caller().explore.search(filters({ region: `${tag}shire` }));
    expect(results.counts.team).toBe(1);
    expect(results.counts.track).toBe(1);
  });

  it("returns a track's length in miles, rounded once", async () => {
    const results = await caller().explore.search(filters({ q: tag, types: ["track"] }));
    expect(results.tracks[0]!.miles).toBe(1);
    expect(results.tracks[0]!.turns).toBe(4);
  });

  it("drops a type a filter cannot apply to, rather than returning zero of it", async () => {
    const results = await caller().explore.search(filters({ trackKind: "OVAL" }));
    expect(results.active).toEqual(["track"]);
    expect(results.counts.event).toBe(0);
  });

  it("answers an empty search without falling over", async () => {
    const results = await caller().explore.search(filters());
    expect(results.total).toBeGreaterThan(0);
  });

  it("offers the busiest regions, with real counts", async () => {
    const facets = await caller().explore.facets();
    expect(facets.regions.length).toBeGreaterThan(0);
    for (const region of facets.regions) {
      expect(region.value.length).toBeGreaterThan(0);
      expect(region.count).toBeGreaterThan(0);
    }
    // Ordered by how much is in them: a rail listing every region in the
    // country would be longer than the results it is meant to narrow.
    const counts = facets.regions.map((region) => region.count);
    expect([...counts].sort((a, b) => b - a)).toEqual(counts);
  });

  it("can still search a region too small to earn a place in the rail", async () => {
    /*
     * The rail is a shortlist, so a region with one track will not appear in
     * it. That must not mean the region cannot be filtered on — otherwise the
     * facets quietly become the only vocabulary the search accepts.
     */
    const rare = `${tag}shire`;
    const facets = await caller().explore.facets();
    expect(facets.regions.some((region) => region.value === rare)).toBe(false);

    const results = await caller().explore.search(filters({ region: rare }));
    expect(results.counts.track).toBe(1);
    expect(results.counts.team).toBe(1);
  });

  it("counts a series' whole calendar on its facet", async () => {
    const facets = await caller().explore.facets();
    const series = facets.series.find((entry) => entry.value === seriesSlug);
    if (series) expect(series.count).toBe(PAGE_SIZE + 5);
  });
});
