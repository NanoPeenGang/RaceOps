import { z } from "zod";
import { EventStatus, Prisma, SeriesDiscipline, TrackKind } from "@prisma/client";
import { createTRPCRouter, publicProcedure } from "@/server/trpc/trpc";
import {
  DISCIPLINES,
  EXPLORE_TYPES,
  MAX_PAGE,
  MIXED_PER_TYPE,
  PAGE_SIZE,
  TRACK_KINDS,
  WHEN_OPTIONS,
  whenRange,
  type ExploreFilters,
  type ExploreType,
} from "@/lib/explore";

/**
 * One search across events, series, teams and tracks.
 *
 * Public throughout: everything here is already on four directory pages that
 * need no account, and the point of the exercise is that they stop being four.
 *
 * The two modes are not a detail. Narrowed to a single type this stands in for
 * a directory and paginates like one; across everything it returns the best
 * few of each, because a page of thirty events with the teams below the fold
 * is the events directory with extra steps.
 */

const filtersInput = z.object({
  q: z.string().max(120).default(""),
  types: z.array(z.enum(EXPLORE_TYPES)).max(EXPLORE_TYPES.length).default([]),
  discipline: z.enum(DISCIPLINES).nullable().default(null),
  when: z.enum(WHEN_OPTIONS).nullable().default(null),
  country: z.string().max(8).nullable().default(null),
  region: z.string().max(120).nullable().default(null),
  seriesSlug: z.string().max(160).nullable().default(null),
  trackKind: z.enum(TRACK_KINDS).nullable().default(null),
  page: z.number().int().min(0).max(MAX_PAGE).default(0),
});

type Filters = z.infer<typeof filtersInput>;

/** Only published work is browsable; a draft is the organiser's business. */
const LISTABLE = [EventStatus.PUBLISHED, EventStatus.COMPLETED];

function nameFilter(q: string) {
  const trimmed = q.trim();
  return trimmed.length > 0
    ? { contains: trimmed, mode: Prisma.QueryMode.insensitive }
    : undefined;
}

/**
 * Whether a type can satisfy the current filters at all.
 *
 * A search for "this weekend" cannot be answered by a track, and one narrowed
 * to a rally stage cannot be answered by a team. Rather than returning zero
 * rows for those and letting somebody wonder whether the data is missing, the
 * type is dropped from the search and the page says which filter excluded it.
 */
export function typesInPlay(filters: Pick<Filters, "types" | "when" | "trackKind" | "discipline" | "seriesSlug">): ExploreType[] {
  let types: ExploreType[] = filters.types.length > 0 ? [...filters.types] : [...EXPLORE_TYPES];
  if (filters.when) types = types.filter((type) => type === "event");
  if (filters.trackKind) types = types.filter((type) => type === "track");
  if (filters.seriesSlug) types = types.filter((type) => type === "event");
  if (filters.discipline) types = types.filter((type) => type === "series" || type === "event");
  return types;
}

function eventWhere(filters: Filters, now: Date): Prisma.RaceEventWhereInput {
  const where: Prisma.RaceEventWhereInput = {
    status: { in: LISTABLE },
    name: nameFilter(filters.q),
  };
  if (filters.when) {
    const range = whenRange(filters.when, now);
    where.date = { ...(range.from ? { gte: range.from } : {}), ...(range.to ? { lt: range.to } : {}) };
  }
  /*
   * Both narrowings are conditions on the event's series, so they are built
   * as one object. Note what this excludes: an event with no managed series
   * cannot match either, which is right — it has no discipline to filter on.
   */
  const seriesConditions: Prisma.SeriesWhereInput = {};
  if (filters.seriesSlug) seriesConditions.slug = filters.seriesSlug;
  if (filters.discipline) seriesConditions.discipline = filters.discipline as SeriesDiscipline;
  if (Object.keys(seriesConditions).length > 0) where.series = seriesConditions;
  if (filters.country || filters.region) {
    where.trackLayout = {
      track: {
        ...(filters.country ? { country: filters.country } : {}),
        ...(filters.region ? { region: filters.region } : {}),
      },
    };
  }
  return where;
}

function seriesWhere(filters: Filters): Prisma.SeriesWhereInput {
  return {
    name: nameFilter(filters.q),
    ...(filters.discipline ? { discipline: filters.discipline as SeriesDiscipline } : {}),
  };
}

function teamWhere(filters: Filters): Prisma.TeamWhereInput {
  return {
    name: nameFilter(filters.q),
    // Teams record a free-text home base rather than a structured region, so
    // a region filter matches against that rather than pretending otherwise.
    ...(filters.region ? { homeBase: { contains: filters.region, mode: Prisma.QueryMode.insensitive } } : {}),
  };
}

function trackWhere(filters: Filters): Prisma.TrackWhereInput {
  return {
    OR: filters.q.trim()
      ? [
          { name: nameFilter(filters.q) as Prisma.StringFilter },
          { city: nameFilter(filters.q) as Prisma.StringNullableFilter },
        ]
      : undefined,
    ...(filters.country ? { country: filters.country } : {}),
    ...(filters.region ? { region: filters.region } : {}),
    ...(filters.trackKind ? { kind: filters.trackKind as TrackKind } : {}),
  };
}

const WHEN_FORMAT = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const MILES_PER_METRE = 0.000621371;

export const exploreRouter = createTRPCRouter({
  /**
   * The facet rail's options and their counts.
   *
   * Separate from the search because it changes far less often than the
   * query does — somebody typing into the box should not re-count every
   * region on every keystroke.
   */
  facets: publicProcedure.query(async ({ ctx }) => {
    const [countries, regions, series] = await Promise.all([
      ctx.db.track.groupBy({
        by: ["country"],
        _count: { _all: true },
        orderBy: { _count: { id: "desc" } },
        take: 12,
      }),
      ctx.db.track.groupBy({
        by: ["region"],
        _count: { _all: true },
        orderBy: { _count: { id: "desc" } },
        take: 14,
      }),
      ctx.db.series.findMany({
        orderBy: { name: "asc" },
        take: 24,
        select: { slug: true, name: true, _count: { select: { events: true } } },
      }),
    ]);

    return {
      countries: countries
        .filter((row) => row.country)
        .map((row) => ({ value: row.country!, count: row._count._all })),
      regions: regions
        .filter((row) => row.region)
        .map((row) => ({ value: row.region!, count: row._count._all })),
      series: series.map((entry) => ({
        value: entry.slug,
        label: entry.name,
        count: entry._count.events,
      })),
    };
  }),

  search: publicProcedure.input(filtersInput).query(async ({ ctx, input }) => {
    const now = new Date();
    const active = typesInPlay(input);
    const sole = input.types.length === 1 ? input.types[0]! : null;
    const take = sole ? PAGE_SIZE : MIXED_PER_TYPE;
    const skip = sole ? input.page * PAGE_SIZE : 0;

    const wants = (type: ExploreType) => active.includes(type);

    const [events, eventCount, series, seriesCount, teams, teamCount, tracks, trackCount] =
      await Promise.all([
        wants("event")
          ? ctx.db.raceEvent.findMany({
              where: eventWhere(input, now),
              // Soonest first when looking forward; most recent first when
              // looking back, since "already run" means the last one, not the
              // first one ever held.
              orderBy: { date: input.when === "past" ? "desc" : "asc" },
              take,
              skip,
              select: {
                id: true,
                name: true,
                date: true,
                venue: true,
                seriesLabel: true,
                series: { select: { name: true, slug: true } },
                trackLayout: { select: { track: { select: { name: true, city: true, region: true } } } },
                _count: { select: { registrations: true } },
              },
            })
          : [],
        wants("event") ? ctx.db.raceEvent.count({ where: eventWhere(input, now) }) : 0,
        wants("series")
          ? ctx.db.series.findMany({
              where: seriesWhere(input),
              orderBy: { name: "asc" },
              take,
              skip,
              select: {
                slug: true,
                name: true,
                platform: true,
                season: true,
                discipline: true,
                _count: { select: { events: true } },
              },
            })
          : [],
        wants("series") ? ctx.db.series.count({ where: seriesWhere(input) }) : 0,
        wants("team")
          ? ctx.db.team.findMany({
              where: teamWhere(input),
              orderBy: { name: "asc" },
              take,
              skip,
              select: {
                slug: true,
                name: true,
                homeBase: true,
                _count: { select: { roster: true } },
              },
            })
          : [],
        wants("team") ? ctx.db.team.count({ where: teamWhere(input) }) : 0,
        wants("track")
          ? ctx.db.track.findMany({
              where: trackWhere(input),
              orderBy: { name: "asc" },
              take,
              skip,
              select: {
                slug: true,
                name: true,
                city: true,
                region: true,
                country: true,
                kind: true,
                layouts: {
                  where: { isPrimary: true },
                  take: 1,
                  select: { lengthMeters: true, turnCount: true },
                },
              },
            })
          : [],
        wants("track") ? ctx.db.track.count({ where: trackWhere(input) }) : 0,
      ]);

    return {
      /** Which types the filters left standing, so the page can say why. */
      active,
      sole,
      counts: {
        event: eventCount,
        series: seriesCount,
        team: teamCount,
        track: trackCount,
      },
      total: eventCount + seriesCount + teamCount + trackCount,
      events: events.map((event) => ({
        id: event.id,
        name: event.name,
        href: `/events/${event.id}`,
        when: WHEN_FORMAT.format(event.date),
        series: event.series?.name ?? event.seriesLabel,
        where:
          event.trackLayout?.track.name ??
          event.venue ??
          [event.trackLayout?.track.city, event.trackLayout?.track.region]
            .filter(Boolean)
            .join(", "),
        entries: event._count.registrations,
      })),
      series: series.map((entry) => ({
        slug: entry.slug,
        name: entry.name,
        href: `/series/${entry.slug}`,
        platform: entry.platform,
        season: entry.season,
        discipline: entry.discipline,
        events: entry._count.events,
      })),
      teams: teams.map((team) => ({
        slug: team.slug,
        name: team.name,
        href: `/teams/${team.slug}`,
        homeBase: team.homeBase,
        members: team._count.roster,
      })),
      tracks: tracks.map((track) => {
        const primary = track.layouts[0];
        return {
          slug: track.slug,
          name: track.name,
          href: `/tracks/${track.slug}`,
          where: [track.city, track.region].filter(Boolean).join(", "),
          country: track.country,
          kind: track.kind,
          // Rounded once, on the way out — a length in metres means nothing
          // to somebody choosing between two circuits.
          // A layout can exist without a measured length — a sim venue, or
          // one added before somebody looked it up.
          miles:
            primary?.lengthMeters != null
              ? Math.round(primary.lengthMeters * MILES_PER_METRE * 100) / 100
              : null,
          turns: primary?.turnCount ?? null,
        };
      }),
    };
  }),
});

export type { ExploreFilters };
