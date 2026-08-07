import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  EventStatus,
  PlatformRole,
  PrismaClient,
  SeriesDiscipline,
  SeriesRole,
  SeriesRuleKind,
  TrackDirection,
  TrackKind,
} from "@prisma/client";
import { seedReferenceSeries } from "../../prisma/seed-data/seed-series.mts";
import type { SeedSeries } from "../../prisma/seed-data/champcar.mts";
import type { SeedTrack } from "../../prisma/seed-data/us-tracks.mts";

/**
 * Seeding a reference championship.
 *
 * Like the track seed, this runs on every deploy against databases with real
 * seasons in them, so the behaviour that matters is what it does the *second*
 * time and what it does when it meets somebody's live series. Opt in with
 * RUN_DB_TESTS=1.
 */
const ENABLED = process.env.RUN_DB_TESTS === "1";
const db = ENABLED ? new PrismaClient() : (null as unknown as PrismaClient);

describe.skipIf(!ENABLED)("reference series seeding (integration)", () => {
  const run = Date.now();

  /*
   * A private fixture rather than the real ChampCar calendar: this test is
   * about the seeding rules, and asserting against shipped data would make
   * every future schedule correction break the suite.
   *
   * "ZW" is this suite's sentinel region and nobody else's. Sharing one with
   * the track-seed suite made both flaky — each cleaned up by region, so
   * whichever finished first deleted the other's fixtures mid-run.
   */
  const tracks: SeedTrack[] = [
    {
      name: `Seed Series Circuit ${run}`,
      kind: TrackKind.CIRCUIT,
      city: "Elkhart Lake",
      state: "ZW",
      layouts: [
        {
          name: "Full Course",
          lengthMeters: 6515,
          direction: TrackDirection.CLOCKWISE,
          isPrimary: true,
        },
        { name: "Short Course", lengthMeters: 3200 },
      ],
    },
  ];

  const slug = `seed-series-${run}`;
  const definition: SeedSeries = {
    name: `Seed Series ${run}`,
    slug,
    discipline: SeriesDiscipline.REAL_WORLD,
    platform: "Circuit",
    season: "2026",
    description: "Fixture championship.",
    sourceUrl: "https://example.test/series",
    checkedOn: "2026-01-15",
    events: [
      {
        name: "Named layout round",
        date: "2026-03-01",
        endDate: "2026-03-02",
        trackName: tracks[0]!.name,
        layoutName: "Short Course",
        venue: `${tracks[0]!.name}, Elkhart Lake, ZY`,
        format: "8-hour enduro",
      },
      {
        name: "Unconfirmed layout round",
        date: "2026-04-01",
        trackName: tracks[0]!.name,
        venue: `${tracks[0]!.name}, Elkhart Lake, ZY`,
        format: "7-hour enduro",
      },
      {
        name: "Deliberately unlinked round",
        date: "2026-05-01",
        trackName: tracks[0]!.name,
        layoutName: null,
        venue: `${tracks[0]!.name}, Elkhart Lake, ZY`,
        format: "12-hour enduro",
        description: "Run on a configuration the directory does not carry.",
      },
      {
        name: "Typo layout round",
        date: "2026-06-01",
        trackName: tracks[0]!.name,
        layoutName: "No Such Course",
        venue: `${tracks[0]!.name}, Elkhart Lake, ZY`,
        format: "7-hour enduro",
      },
      // Same circuit, same name as the first round, different weekend: the
      // series visits some venues twice a season and matching on name alone
      // would silently drop the second visit.
      {
        name: "Named layout round",
        date: "2026-09-01",
        trackName: tracks[0]!.name,
        layoutName: "Short Course",
        venue: `${tracks[0]!.name}, Elkhart Lake, ZY`,
        format: "8-hour enduro",
      },
    ],
    rules: [
      {
        kind: SeriesRuleKind.OTHER,
        title: "This is a summary",
        detail: "Read the rule book.",
        citation: "Fixture rules",
        sourceUrl: "https://example.test/rules",
        sortOrder: 0,
      },
      {
        kind: SeriesRuleKind.ELIGIBILITY,
        title: "Points cap",
        detail: "500.",
        citation: "Fixture rules",
        sourceUrl: "https://example.test/rules",
        sortOrder: 1,
      },
    ],
  };

  const seed = () => seedReferenceSeries(db, [definition], tracks);

  beforeAll(async () => {
    if (!ENABLED) return;
    await db.raceEvent.deleteMany({ where: { series: { slug } } });
    await db.series.deleteMany({ where: { slug } });
    await db.track.deleteMany({ where: { region: "ZW" } });
  });

  afterAll(async () => {
    if (!ENABLED) return;
    await db.raceEvent.deleteMany({ where: { series: { slug } } });
    await db.series.deleteMany({ where: { slug } });
    await db.track.deleteMany({ where: { region: "ZW" } });
    await db.$disconnect();
  });

  it("creates the series, its calendar and its regulations", async () => {
    const summary = await seed();
    expect(summary.seriesCreated).toBe(1);
    expect(summary.seriesSkipped).toBe(0);
    expect(summary.eventsCreated).toBe(5);
    expect(summary.rulesCreated).toBe(2);

    const series = await db.series.findUniqueOrThrow({
      where: { slug },
      include: { rules: true, organizers: true, events: true },
    });
    expect(series.isReference).toBe(true);
    expect(series.sourceUrl).toBe("https://example.test/series");
    // No organizers is what makes every organizer-only mutation refuse this
    // copy without needing a special case for reference series.
    expect(series.organizers).toEqual([]);
    expect(series.rules).toHaveLength(2);
    // Dated when the data file was checked, not when the seed ran — otherwise
    // every deploy silently re-dates somebody else's rule book to today.
    for (const rule of series.rules) {
      expect(rule.verifiedOn?.toISOString().slice(0, 10)).toBe("2026-01-15");
    }
    expect(series.events.every((e) => e.status === EventStatus.PUBLISHED)).toBe(
      true,
    );
  });

  it("seeds the venues the calendar needs", async () => {
    const track = await db.track.findFirstOrThrow({
      where: { name: tracks[0]!.name },
      include: { layouts: true },
    });
    expect(track.isReference).toBe(true);
    expect(track.layouts).toHaveLength(2);
  });

  it("links a round to the configuration the data names, not the primary one", async () => {
    // The whole point of naming a layout: a circuit's primary configuration is
    // not the one a given series races, and linking it would put the wrong map
    // and the wrong length on the round.
    const round = await db.raceEvent.findFirstOrThrow({
      where: { series: { slug }, date: new Date("2026-03-01T00:00:00") },
      include: { trackLayout: true },
    });
    expect(round.trackLayout?.name).toBe("Short Course");
  });

  it("falls back to the primary layout, and says on the event that it did", async () => {
    const round = await db.raceEvent.findFirstOrThrow({
      where: { name: "Unconfirmed layout round", series: { slug } },
      include: { trackLayout: true },
    });
    expect(round.trackLayout?.name).toBe("Full Course");
    // Unmarked, this is indistinguishable from a sourced fact.
    expect(round.description).toContain("not stated in the published schedule");
  });

  it("links nothing when the data says the configuration is not carried", async () => {
    const round = await db.raceEvent.findFirstOrThrow({
      where: { name: "Deliberately unlinked round", series: { slug } },
    });
    expect(round.trackLayoutId).toBeNull();
    // The free-text venue is what the round falls back to.
    expect(round.venue).toContain(tracks[0]!.name);
  });

  it("leaves a round unlinked rather than substituting when a named layout is missing", async () => {
    // A typo in the data file should surface as a missing map, not hide behind
    // a plausible-looking one.
    const round = await db.raceEvent.findFirstOrThrow({
      where: { name: "Typo layout round", series: { slug } },
    });
    expect(round.trackLayoutId).toBeNull();
  });

  it("keeps both visits to a circuit that appears twice in a season", async () => {
    const visits = await db.raceEvent.findMany({
      where: { name: "Named layout round", series: { slug } },
    });
    expect(visits).toHaveLength(2);
  });

  it("counts linked and unlinked rounds honestly", async () => {
    const rounds = await db.raceEvent.findMany({ where: { series: { slug } } });
    const linked = rounds.filter((round) => round.trackLayoutId).length;
    expect(linked).toBe(3);
    expect(rounds.length - linked).toBe(2);
  });

  it("adds nothing on a second run", async () => {
    const summary = await seed();
    expect(summary.seriesCreated).toBe(0);
    expect(summary.seriesPresent).toBe(1);
    expect(summary.eventsCreated).toBe(0);
    expect(summary.rulesCreated).toBe(0);

    expect(await db.raceEvent.count({ where: { series: { slug } } })).toBe(5);
    expect(await db.seriesRule.count({ where: { series: { slug } } })).toBe(2);
  });

  it("fills a column that is null without touching one that is not", async () => {
    const series = await db.series.findUniqueOrThrow({ where: { slug } });
    await db.series.update({
      where: { id: series.id },
      data: {
        season: null,
        sourceUrl: null,
        description: "Corrected by hand.",
      },
    });

    await seed();

    const after = await db.series.findUniqueOrThrow({ where: { slug } });
    expect(after.season).toBe("2026");
    expect(after.sourceUrl).toBe("https://example.test/series");
    // The half that matters more: a deploy must not silently revert somebody's
    // correction.
    expect(after.description).toBe("Corrected by hand.");
  });

  it("seeds a series that has rules but no calendar", async () => {
    /*
     * A supported shape, not a degenerate one: the Lemons entry ships its rule
     * book with no rounds because its schedule could not be verified, and the
     * loader has to treat that as a series rather than as nothing.
     */
    const rulesOnly: SeedSeries = {
      ...definition,
      name: `Rules Only ${run}`,
      slug: `rules-only-${run}`,
      events: [],
      rules: [
        {
          kind: SeriesRuleKind.OTHER,
          title: "This is a summary",
          detail: "Read the rule book.",
          citation: "Fixture rules",
          sourceUrl: "https://example.test/rules",
        },
      ],
    };

    const summary = await seedReferenceSeries(db, [rulesOnly], []);
    expect(summary.seriesCreated).toBe(1);
    expect(summary.eventsCreated).toBe(0);
    expect(summary.rulesCreated).toBe(1);
    // Not counted as an unlinked round either — there is no round.
    expect(summary.eventsUnlinked).toBe(0);

    const created = await db.series.findUniqueOrThrow({
      where: { slug: rulesOnly.slug },
      include: { rules: true, events: true },
    });
    expect(created.isReference).toBe(true);
    expect(created.events).toEqual([]);
    expect(created.rules).toHaveLength(1);

    await db.series.delete({ where: { id: created.id } });
  });

  it("refuses to write into a live series holding the same slug", async () => {
    // The single most destructive thing this script could do is replace a real
    // season's calendar with a copy of a published schedule.
    const series = await db.series.findUniqueOrThrow({ where: { slug } });
    const user = await db.user.create({
      data: {
        email: `seriesseed_${run}@example.test`,
        authProviderId: `clerk_seriesseed_${run}`,
        // Platform staff, so these fixtures bypass the access-request queue —
        // the queue itself is exercised in access-flow.test.ts, and making every
        // suite apply for a team first would test one gate thirty times.
        platformRole: PlatformRole.ADMIN,
      },
    });
    await db.series.update({
      where: { id: series.id },
      data: {
        isReference: false,
        organizers: { create: { userId: user.id, role: SeriesRole.OWNER } },
      },
    });
    await db.raceEvent.deleteMany({ where: { seriesId: series.id } });
    await db.seriesRule.deleteMany({ where: { seriesId: series.id } });

    const summary = await seed();
    expect(summary.seriesSkipped).toBe(1);
    expect(summary.seriesCreated).toBe(0);
    expect(summary.eventsCreated).toBe(0);
    expect(summary.rulesCreated).toBe(0);

    // Nothing was written back into the organizer's series.
    expect(await db.raceEvent.count({ where: { seriesId: series.id } })).toBe(0);
    expect(await db.seriesRule.count({ where: { seriesId: series.id } })).toBe(0);

    await db.seriesMembership.deleteMany({ where: { userId: user.id } });
    await db.user.delete({ where: { id: user.id } });
  });
});
