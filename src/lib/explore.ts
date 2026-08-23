/**
 * Explore: one search across everything, instead of four directories.
 *
 * Events, series, teams and tracks each had their own index page, and all four
 * were the same query with the filter nailed down — "show me things, of this
 * one type, that I might want". Somebody looking for endurance racing in the
 * southeast this month had to run that search four times and hold the answers
 * in their head.
 *
 * This file is the filter state and nothing else: what can be narrowed, how it
 * survives a reload or a shared link, and how it reads back as English. The
 * querying lives in the router; the rendering lives in the page.
 */

export const EXPLORE_TYPES = ["event", "series", "team", "track"] as const;
export type ExploreType = (typeof EXPLORE_TYPES)[number];

export const TYPE_LABELS: Record<ExploreType, string> = {
  event: "Events",
  series: "Series",
  team: "Teams",
  track: "Tracks",
};

/** Singular, for the chip on a result card. */
export const TYPE_LABELS_ONE: Record<ExploreType, string> = {
  event: "Event",
  series: "Series",
  team: "Team",
  track: "Track",
};

export const DISCIPLINES = ["REAL_WORLD", "SIM"] as const;
export type Discipline = (typeof DISCIPLINES)[number];

export const DISCIPLINE_LABELS: Record<Discipline, string> = {
  REAL_WORLD: "Real world",
  SIM: "Sim racing",
};

/**
 * Time windows, phrased the way people ask.
 *
 * "This weekend" is the one that matters and the reason this is a named set
 * rather than a date picker: the question at eight on a Friday is not "events
 * between two dates", it is "what is on".
 */
export const WHEN_OPTIONS = ["weekend", "upcoming", "season", "past"] as const;
export type When = (typeof WHEN_OPTIONS)[number];

export const WHEN_LABELS: Record<When, string> = {
  weekend: "This weekend",
  upcoming: "Next 30 days",
  season: "Rest of the season",
  past: "Already run",
};

export const TRACK_KINDS = [
  "CIRCUIT",
  "STREET",
  "RALLY_STAGE",
  "OVAL",
  "KART",
  "AUTOCROSS",
  "OTHER",
] as const;
export type TrackKind = (typeof TRACK_KINDS)[number];

export const TRACK_KIND_LABELS: Record<TrackKind, string> = {
  CIRCUIT: "Circuit",
  STREET: "Street course",
  RALLY_STAGE: "Rally stage",
  OVAL: "Oval",
  KART: "Kart track",
  AUTOCROSS: "Autocross",
  OTHER: "Other",
};

export interface ExploreFilters {
  q: string;
  /** Empty means every type — "all" is the absence of a filter, not a value. */
  types: ExploreType[];
  discipline: Discipline | null;
  when: When | null;
  country: string | null;
  region: string | null;
  seriesSlug: string | null;
  trackKind: TrackKind | null;
  page: number;
}

export const EMPTY_FILTERS: ExploreFilters = {
  q: "",
  types: [],
  discipline: null,
  when: null,
  country: null,
  region: null,
  seriesSlug: null,
  trackKind: null,
  page: 0,
};

/** How many results a single-type search returns per page. */
export const PAGE_SIZE = 24;
/**
 * The furthest page anybody can ask for.
 *
 * Clamped here rather than rejected at the router, which is the difference
 * between a hand-edited `?page=999999999` quietly showing the last page and
 * the same URL erroring the whole search out.
 */
export const MAX_PAGE = 400;
/** How many of each type a mixed search shows before "show only these". */
export const MIXED_PER_TYPE = 6;

/**
 * Whether the search is narrowed to exactly one kind of thing.
 *
 * The two modes genuinely differ: one type paginates properly, because it is
 * standing in for a directory; a mixed search shows the best few of each,
 * because a page of thirty events with the teams pushed below the fold is not
 * a search across everything, it is the events directory with extra steps.
 */
export function soleType(filters: ExploreFilters): ExploreType | null {
  return filters.types.length === 1 ? filters.types[0]! : null;
}

/* -------------------------------------------------------------------------
 * The query string
 *
 * Filters live in the URL rather than in component state so that a search can
 * be reloaded, bookmarked and — the one that matters — sent to somebody else.
 * ---------------------------------------------------------------------- */

function oneOf<T extends string>(value: string | null, allowed: readonly T[]): T | null {
  return value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

/**
 * Read filters out of a query string.
 *
 * Total: anything unrecognised is dropped rather than rejected. These URLs get
 * hand-edited and pasted into chat clients that mangle them, and a filter page
 * that throws on a stray parameter is worse than one that ignores it.
 */
export function parseFilters(params: URLSearchParams): ExploreFilters {
  const rawTypes = (params.get("type") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value): value is ExploreType =>
      (EXPLORE_TYPES as readonly string[]).includes(value),
    );

  const page = Number.parseInt(params.get("page") ?? "", 10);

  return {
    q: (params.get("q") ?? "").slice(0, 120),
    // De-duplicated and put back in canonical order, so that ?type=team,event
    // and ?type=event,team are the same search and share a cache entry.
    types: EXPLORE_TYPES.filter((type) => rawTypes.includes(type)),
    discipline: oneOf(params.get("discipline"), DISCIPLINES),
    when: oneOf(params.get("when"), WHEN_OPTIONS),
    country: params.get("country") || null,
    region: params.get("region") || null,
    seriesSlug: params.get("series") || null,
    trackKind: oneOf(params.get("kind"), TRACK_KINDS),
    page: Number.isFinite(page) && page > 0 ? Math.min(page, MAX_PAGE) : 0,
  };
}

/**
 * Write filters back out.
 *
 * Only what is set: a URL carrying eight empty parameters is unreadable, and
 * unreadable URLs do not get shared.
 */
export function toQueryString(filters: ExploreFilters): string {
  const params = new URLSearchParams();
  if (filters.q.trim()) params.set("q", filters.q.trim());
  if (filters.types.length > 0) params.set("type", filters.types.join(","));
  if (filters.discipline) params.set("discipline", filters.discipline);
  if (filters.when) params.set("when", filters.when);
  if (filters.country) params.set("country", filters.country);
  if (filters.region) params.set("region", filters.region);
  if (filters.seriesSlug) params.set("series", filters.seriesSlug);
  if (filters.trackKind) params.set("kind", filters.trackKind);
  if (filters.page > 0) params.set("page", String(filters.page));
  return params.toString();
}

export function exploreHref(filters: ExploreFilters): string {
  const query = toQueryString(filters);
  return query ? `/explore?${query}` : "/explore";
}

/**
 * Change one thing and go back to the first page.
 *
 * Keeping the page number across a filter change is the classic way to land
 * somebody on an empty page three of a result set that now has eleven rows.
 */
export function withFilter(
  filters: ExploreFilters,
  patch: Partial<ExploreFilters>,
): ExploreFilters {
  return { ...filters, ...patch, page: patch.page ?? 0 };
}

/** Add or remove one type, keeping the canonical order. */
export function toggleType(filters: ExploreFilters, type: ExploreType): ExploreFilters {
  const next = filters.types.includes(type)
    ? filters.types.filter((candidate) => candidate !== type)
    : EXPLORE_TYPES.filter((candidate) => candidate === type || filters.types.includes(candidate));
  return withFilter(filters, { types: next });
}

export function hasAnyFilter(filters: ExploreFilters): boolean {
  return (
    filters.q.trim().length > 0 ||
    filters.types.length > 0 ||
    filters.discipline !== null ||
    filters.when !== null ||
    filters.country !== null ||
    filters.region !== null ||
    filters.seriesSlug !== null ||
    filters.trackKind !== null
  );
}

/* -------------------------------------------------------------------------
 * Reading the filters back
 * ---------------------------------------------------------------------- */

export interface AppliedFilter {
  /** What to show on the chip. */
  label: string;
  /** The filters with just this one removed — what the chip's × does. */
  without: ExploreFilters;
}

/**
 * The active filters as removable chips.
 *
 * Every narrowing must be visible and every visible one must be removable.
 * A facet checked in a rail that has scrolled out of view is how somebody ends
 * up staring at an empty result set convinced the search is broken.
 */
export function appliedFilters(
  filters: ExploreFilters,
  names: { seriesName?: string } = {},
): AppliedFilter[] {
  const applied: AppliedFilter[] = [];

  for (const type of filters.types) {
    applied.push({ label: TYPE_LABELS[type], without: toggleType(filters, type) });
  }
  if (filters.discipline) {
    applied.push({
      label: DISCIPLINE_LABELS[filters.discipline],
      without: withFilter(filters, { discipline: null }),
    });
  }
  if (filters.when) {
    applied.push({ label: WHEN_LABELS[filters.when], without: withFilter(filters, { when: null }) });
  }
  if (filters.trackKind) {
    applied.push({
      label: TRACK_KIND_LABELS[filters.trackKind],
      without: withFilter(filters, { trackKind: null }),
    });
  }
  if (filters.region) {
    applied.push({ label: filters.region, without: withFilter(filters, { region: null }) });
  }
  if (filters.country) {
    applied.push({ label: filters.country, without: withFilter(filters, { country: null }) });
  }
  if (filters.seriesSlug) {
    applied.push({
      label: names.seriesName ?? filters.seriesSlug,
      without: withFilter(filters, { seriesSlug: null }),
    });
  }
  return applied;
}

/**
 * The date range a `when` means, resolved against a clock.
 *
 * Takes `now` rather than reading it, so the boundaries can be tested without
 * waiting for a Saturday.
 */
export function whenRange(when: When, now: Date): { from?: Date; to?: Date } {
  const startOfDay = new Date(now);
  startOfDay.setUTCHours(0, 0, 0, 0);

  switch (when) {
    case "weekend": {
      /*
       * Friday through Sunday of the week we are in. Running on a Saturday
       * means the weekend that is happening, not the next one — the whole
       * point of the filter is answering "what is on right now".
       */
      const day = startOfDay.getUTCDay(); // 0 Sun … 6 Sat
      const toFriday = day === 0 ? -2 : 5 - day;
      const friday = new Date(startOfDay);
      friday.setUTCDate(friday.getUTCDate() + toFriday);
      const monday = new Date(friday);
      monday.setUTCDate(monday.getUTCDate() + 3);
      return { from: friday, to: monday };
    }
    case "upcoming": {
      const to = new Date(startOfDay);
      to.setUTCDate(to.getUTCDate() + 30);
      return { from: startOfDay, to };
    }
    case "season": {
      const to = new Date(Date.UTC(startOfDay.getUTCFullYear() + 1, 0, 1));
      return { from: startOfDay, to };
    }
    case "past":
      return { to: startOfDay };
  }
}
