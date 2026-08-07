import { EventStatus } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { CHAMPCAR, CHAMPCAR_TRACKS, type SeedSeries } from "./champcar.mts";
import { LEMONS } from "./lemons.mts";
import { seedReferenceTracks } from "./seed-tracks.mts";

/**
 * Loads the reference championships.
 *
 * Same contract as the track seed, for the same reason — this runs against
 * databases with people's work in them:
 *
 * - **Add** what is not there.
 * - **Fill** a column that is currently null.
 * - **Never overwrite** a column that holds a value, and never delete.
 *
 * One difference from tracks, and it is deliberate. A reference *track* is
 * open to correction by anyone signed in, because a circuit's length is a fact
 * and a typo in one should be fixable by whoever spots it. A reference
 * *series* is not: a championship's calendar and regulations are that
 * organizer's to state, and a wiki-editable rule book would be worse than no
 * rule book. These are updated by re-seeding, or by the organizer taking the
 * row over.
 */

/**
 * The championships that ship with the platform.
 *
 * ChampCar carries a calendar; Lemons carries only its rule book, because its
 * schedule could not be verified — see the note in `lemons.mts`. A series with
 * no rounds is a supported shape rather than a broken one: the rules are worth
 * having on their own, and a round can be added the moment somebody can source
 * one.
 */
export const REFERENCE_SERIES: readonly SeedSeries[] = [CHAMPCAR, LEMONS];

export interface SeriesSeedSummary {
  seriesCreated: number;
  seriesPresent: number;
  seriesSkipped: number;
  eventsCreated: number;
  rulesCreated: number;
  tracksLinked: number;
  /** Events whose venue is not in the track directory, so they carry text. */
  eventsUnlinked: number;
}

const EMPTY: SeriesSeedSummary = {
  seriesCreated: 0,
  seriesPresent: 0,
  seriesSkipped: 0,
  eventsCreated: 0,
  rulesCreated: 0,
  tracksLinked: 0,
  eventsUnlinked: 0,
};

export async function seedReferenceSeries(
  db: PrismaClient,
  series: readonly SeedSeries[] = REFERENCE_SERIES,
  extraTracks = CHAMPCAR_TRACKS,
): Promise<SeriesSeedSummary> {
  // The calendar's venues first, so the events below have something to link
  // to. Reuses the track loader, so a venue already in the directory is left
  // exactly as it is rather than duplicated.
  if (extraTracks.length > 0) {
    await seedReferenceTracks(db, extraTracks);
  }

  const totals = { ...EMPTY };
  for (const definition of series) {
    const one = await seedOneSeries(db, definition);
    totals.seriesCreated += one.seriesCreated;
    totals.seriesPresent += one.seriesPresent;
    totals.seriesSkipped += one.seriesSkipped;
    totals.eventsCreated += one.eventsCreated;
    totals.rulesCreated += one.rulesCreated;
    totals.tracksLinked += one.tracksLinked;
    totals.eventsUnlinked += one.eventsUnlinked;
  }
  return totals;
}

async function seedOneSeries(
  db: PrismaClient,
  definition: SeedSeries,
): Promise<SeriesSeedSummary> {
  const existing = await db.series.findUnique({
    where: { slug: definition.slug },
    select: { id: true, isReference: true },
  });

  /*
   * A real series somebody is running under this slug is theirs. Writing our
   * calendar into it would replace a live season's events with a copy of a
   * published schedule, which is the single most destructive thing this script
   * could do.
   */
  if (existing && !existing.isReference) {
    return { ...EMPTY, seriesSkipped: 1 };
  }

  const totals = { ...EMPTY };
  let seriesId: string;

  if (existing) {
    seriesId = existing.id;
    totals.seriesPresent = 1;
    await fillSeriesBlanks(db, seriesId, definition);
  } else {
    const created = await db.series.create({
      data: {
        name: definition.name,
        slug: definition.slug,
        discipline: definition.discipline,
        platform: definition.platform,
        season: definition.season,
        description: definition.description,
        sourceUrl: definition.sourceUrl,
        isReference: true,
        // No organizers: nobody is running this copy, so every organizer-only
        // mutation refuses it without needing a special case.
      },
      select: { id: true },
    });
    seriesId = created.id;
    totals.seriesCreated = 1;
  }

  const events = await addMissingEvents(db, seriesId, definition);
  totals.eventsCreated = events.created;
  totals.tracksLinked = events.linked;
  totals.eventsUnlinked = events.unlinked;
  totals.rulesCreated = await addMissingRules(db, seriesId, definition);
  return totals;
}

async function fillSeriesBlanks(
  db: PrismaClient,
  seriesId: string,
  definition: SeedSeries,
): Promise<void> {
  const current = await db.series.findUnique({
    where: { id: seriesId },
    select: { description: true, season: true, sourceUrl: true },
  });
  if (!current) return;

  const data: Record<string, unknown> = {};
  if (!current.description) data.description = definition.description;
  if (!current.season) data.season = definition.season;
  if (!current.sourceUrl) data.sourceUrl = definition.sourceUrl;

  if (Object.keys(data).length > 0) {
    await db.series.update({ where: { id: seriesId }, data });
  }
}

/**
 * Adds calendar rounds that are not already there.
 *
 * Matched on name *and* date, not name alone: several rounds visit the same
 * circuit twice in a season, and 2026 has two at Sebring and two at Harris
 * Hill. Matching on name would silently drop the second visit.
 */
async function addMissingEvents(
  db: PrismaClient,
  seriesId: string,
  definition: SeedSeries,
): Promise<{ created: number; linked: number; unlinked: number }> {
  const present = await db.raceEvent.findMany({
    where: { seriesId },
    select: { name: true, date: true },
  });
  const seen = new Set(
    present.map((event) => `${event.name}|${event.date.toISOString().slice(0, 10)}`),
  );

  let created = 0;
  let linked = 0;
  let unlinked = 0;

  for (const round of definition.events) {
    if (seen.has(`${round.name}|${round.date}`)) continue;

    const resolved = await layoutFor(db, round.trackName, round.layoutName);
    if (resolved.layoutId) linked += 1;
    else unlinked += 1;

    await db.raceEvent.create({
      data: {
        seriesId,
        seriesLabel: definition.name,
        name: round.name,
        // Local midnight. ChampCar publishes days rather than green-flag
        // times, and inventing one would put a wrong time on every round.
        date: new Date(`${round.date}T00:00:00`),
        endDate: round.endDate ? new Date(`${round.endDate}T23:59:59`) : null,
        platform: definition.platform,
        // Free text as well as the link: it is what shows if the layout is
        // ever unlinked, and it carries the town, which the layout does not.
        venue: round.venue,
        trackLayoutId: resolved.layoutId,
        description: [round.format, round.description, resolved.caveat]
          .filter(Boolean)
          .join("\n\n"),
        // Published, because a reference calendar that nobody can see is not
        // a calendar. Nothing can be entered — there are no organizers.
        status: EventStatus.PUBLISHED,
      },
    });
    seen.add(`${round.name}|${round.date}`);
    created += 1;
  }

  return { created, linked, unlinked };
}

/**
 * Resolves the layout a round should point at, and says so when it is a guess.
 *
 * A circuit's *primary* layout is not the one a given series races. Autobahn's
 * primary is the full course and ChampCar runs the south; Daytona's is the
 * tri-oval, which no endurance road race uses. So the data file names the
 * configuration wherever the source states it, and where it does not, the
 * fallback is labelled on the event rather than passed off as fact.
 */
async function layoutFor(
  db: PrismaClient,
  trackName: string,
  layoutName: string | null | undefined,
): Promise<{ layoutId: string | null; caveat: string | null }> {
  // Explicitly no layout: the series races a configuration the directory does
  // not carry, and the free-text venue is the honest answer.
  if (layoutName === null) return { layoutId: null, caveat: null };

  const track = await db.track.findFirst({
    where: { name: { equals: trackName, mode: "insensitive" } },
    select: {
      layouts: {
        where: { active: true },
        orderBy: [{ isPrimary: "desc" }, { name: "asc" }],
        select: { id: true, name: true },
      },
    },
  });
  const layouts = track?.layouts ?? [];
  if (layouts.length === 0) return { layoutId: null, caveat: null };

  if (layoutName) {
    const named = layouts.find(
      (layout) => layout.name.toLowerCase() === layoutName.toLowerCase(),
    );
    /*
     * Named but absent means the data file and the directory disagree — a bug
     * in one of them. Linking the primary instead would hide it behind a
     * plausible-looking map, so leave it unlinked and let the count show.
     */
    return { layoutId: named?.id ?? null, caveat: null };
  }

  const primary = layouts[0]!;
  return {
    layoutId: primary.id,
    caveat:
      `Circuit configuration is not stated in the published schedule. ` +
      `Shown here on ${trackName}'s ${primary.name} — check the event's ` +
      `supplementary regulations before you tow.`,
  };
}

/** Adds regulations not already recorded, matched on title. */
async function addMissingRules(
  db: PrismaClient,
  seriesId: string,
  definition: SeedSeries,
): Promise<number> {
  const present = await db.seriesRule.findMany({
    where: { seriesId },
    select: { title: true },
  });
  const titles = new Set(present.map((rule) => rule.title));

  let created = 0;
  for (const rule of definition.rules) {
    if (titles.has(rule.title)) continue;
    await db.seriesRule.create({
      data: {
        seriesId,
        kind: rule.kind,
        title: rule.title,
        detail: rule.detail ?? null,
        citation: rule.citation ?? null,
        sourceUrl: rule.sourceUrl ?? null,
        sortOrder: rule.sortOrder ?? 0,
        /*
         * The date the *data file* was checked, not the date this ran. Using
         * the clock here would have every deploy re-date somebody else's rule
         * book to today, resetting the staleness warning on data nobody has
         * actually re-read — which is the one thing that warning exists for.
         */
        verifiedOn: new Date(`${definition.checkedOn}T00:00:00Z`),
      },
    });
    created += 1;
  }
  return created;
}
