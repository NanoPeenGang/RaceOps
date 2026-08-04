import {
  SeriesDiscipline,
  SeriesRuleKind,
  TrackKind,
} from "@prisma/client";
import type { SeedTrack } from "./us-tracks.mts";

/**
 * The ChampCar Endurance Series, as a reference championship.
 *
 * Budget endurance racing: multi-hour races for cars built to a performance
 * points cap rather than a class formula. Seeded so somebody can look up when
 * and where it runs, and what it requires of a car and a crew, before they
 * have any account relationship with the series.
 *
 * ## Accuracy, and what is deliberately not here
 *
 * This is somebody else's championship. Every figure below is a summary of a
 * published source, cited so a reader can check it, and dated so a stale one
 * is visible as stale. Rule books are revised every winter — the BCCR is on
 * v1.4 as of December 2025 — so this is a starting point for a competitor, not
 * a substitute for the rule book, and the seeded rules say so.
 *
 * Nothing here is a fee, a deadline, or a technical figure that would decide
 * whether a car passes tech. Those change between events and between
 * revisions, and a wrong one costs somebody a build. Where the sources were
 * not specific enough to state something safely, it is left out rather than
 * approximated.
 *
 * Sources:
 * - https://champcar.org/ — schedule and rule book
 * - https://champcar.org/web/pdf/2026_BCCR/2026_BCCR_V1_4.pdf — BCCR v1.4
 * - Grassroots Motorsports, "New venues sprinkled throughout the 2026
 *   ChampCar schedule"
 */

export const CHAMPCAR_SOURCE = "https://champcar.org/";
const BCCR = "https://champcar.org/web/pdf/2026_BCCR/2026_BCCR_V1_4.pdf";
/** When these entries were last checked against the published sources. */
const CHECKED = "2026-08-04";

export interface SeedSeriesRule {
  kind: SeriesRuleKind;
  title: string;
  detail?: string;
  citation?: string;
  sourceUrl?: string;
  sortOrder?: number;
}

export interface SeedSeriesEvent {
  name: string;
  /** Local date the event starts, ISO. Times are not published per round. */
  date: string;
  /** Last day, where the event runs over more than one. */
  endDate?: string;
  /** Track name as seeded in `us-tracks.mts`, for linking to a layout. */
  trackName: string;
  /**
   * Which configuration the round runs on. Three states, because "the circuit's
   * usual layout" is a guess and several of these venues have four:
   *
   * - a **name** — the schedule or the series' own entry pages say which course
   *   it is, so link that one and say nothing further.
   * - **omitted** — the configuration is not published. Link the circuit's
   *   primary layout so the round still carries a map and a length, and note on
   *   the event that the configuration is unconfirmed.
   * - **null** — the series races a configuration the directory does not carry.
   *   Link nothing: the free-text venue is the honest answer, and pointing at
   *   the wrong course would be worse than pointing at none.
   */
  layoutName?: string | null;
  /** Free-text venue, used when the track is not in the directory. */
  venue: string;
  /** The race format as the series publishes it. */
  format: string;
  description?: string;
}

export interface SeedSeries {
  name: string;
  slug: string;
  discipline: SeriesDiscipline;
  platform: string;
  season: string;
  description: string;
  sourceUrl: string;
  /**
   * The date this file was last checked against the published sources, ISO.
   *
   * Stamped onto the seeded regulations instead of the clock at seed time,
   * which would have every deploy re-date somebody else's rule book to today
   * and quietly reset the staleness warning on data nobody has re-read.
   */
  checkedOn: string;
  events: SeedSeriesEvent[];
  rules: SeedSeriesRule[];
}

/**
 * Venues on the ChampCar calendar that the geographic starter set does not
 * carry.
 *
 * Kept here rather than in `us-tracks.mts` because they are here for a
 * different reason: that list is two to five circuits per state, chosen for
 * coverage, and these are chosen because a seeded series races at them. Mixing
 * the two would quietly break the coverage rule the other list is tested
 * against.
 */
export const CHAMPCAR_TRACKS: SeedTrack[] = [
  {
    name: "Harris Hill Raceway",
    kind: TrackKind.CIRCUIT,
    city: "San Marcos",
    state: "TX",
    notes:
      "Known as H2R. Over 150 feet of elevation change, including the rise and fall of Santa Rita at turn 4.",
    layouts: [
      { name: "Full Course", lengthMeters: 2929, turnCount: 11, isPrimary: true },
    ],
  },
  {
    name: "G2 Motorsports Park",
    kind: TrackKind.CIRCUIT,
    city: "Anna",
    state: "TX",
    notes:
      "Opened as a private club circuit north of Dallas; splits into east and west courses.",
    layouts: [
      { name: "Full Course", lengthMeters: 4989, turnCount: 22, isPrimary: true },
      { name: "West Course", lengthMeters: 3058 },
      { name: "East Course", lengthMeters: 1931 },
    ],
  },
];

export const CHAMPCAR: SeedSeries = {
  name: "ChampCar Endurance Series",
  slug: "champcar-endurance-series",
  discipline: SeriesDiscipline.REAL_WORLD,
  platform: "Circuit",
  season: "2026",
  description:
    "Budget endurance racing in the United States: multi-hour races for cars built to a performance points cap rather than a class formula. Most rounds run a pair of enduros across a weekend, with a handful of single long races and a couple of overnight events.\n\nThis is a reference copy of the published calendar and a summary of the rule book, seeded so you can plan a season before you enter one. Always check the current BCCR and the event's supplementary regulations before building or towing.",
  sourceUrl: CHAMPCAR_SOURCE,
  checkedOn: CHECKED,

  /*
   * The 2026 calendar as published. Dates are the event days; ChampCar does
   * not publish a green-flag time per round in the schedule, so the seeded
   * time is the start of the first day and organizers set the real running
   * order in the schedule tab.
   */
  events: [
    {
      name: "Michelin Raceway Road Atlanta",
      date: "2026-02-06",
      endDate: "2026-02-07",
      trackName: "Michelin Raceway Road Atlanta",
      layoutName: "Full Course",
      venue: "Michelin Raceway Road Atlanta, Braselton, GA",
      format: "Test day + 14-hour enduro",
    },
    {
      name: "G2 Motorsports Park",
      date: "2026-02-28",
      endDate: "2026-03-01",
      trackName: "G2 Motorsports Park",
      // The east and west courses are the halves, run when the facility splits
      // the circuit for two groups at once; an enduro uses the whole thing.
      layoutName: "Full Course",
      venue: "G2 Motorsports Park, Anna, TX",
      format: "8-hour + 7-hour enduros",
      description: "New venue for 2026.",
    },
    {
      name: "Dominion Raceway",
      date: "2026-03-14",
      endDate: "2026-03-15",
      trackName: "Dominion Raceway",
      // The alternative is a quarter-mile oval.
      layoutName: "Road Course",
      venue: "Dominion Raceway, Woodford, VA",
      format: "8-hour + 7-hour enduros",
    },
    {
      name: "Daytona International Speedway",
      date: "2026-04-11",
      trackName: "Daytona International Speedway",
      // Named explicitly because Daytona's primary layout in the directory is
      // the tri-oval, and a road-racing series does not run 14 hours on it.
      layoutName: "Sports Car Course",
      venue: "Daytona International Speedway, Daytona Beach, FL",
      format: "14-hour enduro",
    },
    {
      name: "GingerMan Raceway",
      date: "2026-04-18",
      endDate: "2026-04-19",
      trackName: "GingerMan Raceway",
      layoutName: "Full Course",
      venue: "GingerMan Raceway, South Haven, MI",
      format: "8-hour + 7-hour enduros",
    },
    {
      name: "Harris Hill Raceway",
      date: "2026-05-02",
      endDate: "2026-05-03",
      trackName: "Harris Hill Raceway",
      layoutName: "Full Course",
      venue: "Harris Hill Raceway, San Marcos, TX",
      format: "8-hour + 7-hour enduros",
    },
    {
      name: "Watkins Glen International",
      date: "2026-05-22",
      endDate: "2026-05-24",
      trackName: "Watkins Glen International",
      venue: "Watkins Glen International, Watkins Glen, NY",
      format: "Test day + 7-hour + 7-hour enduros",
    },
    {
      name: "Autobahn Country Club",
      date: "2026-06-13",
      endDate: "2026-06-14",
      trackName: "Autobahn Country Club",
      // ChampCar's own entry pages title this round "Autobahn Country Club -
      // South Course". Autobahn's primary layout is the full circuit, so
      // without this the round would be linked to the wrong one.
      layoutName: "South Course",
      venue: "Autobahn Country Club, Joliet, IL",
      format: "8-hour + 7-hour enduros",
    },
    {
      name: "Sebring International Raceway",
      date: "2026-06-27",
      endDate: "2026-06-28",
      trackName: "Sebring International Raceway",
      layoutName: "Full Course",
      venue: "Sebring International Raceway, Sebring, FL",
      format: "Overnight 12-hour enduro",
    },
    {
      name: "Lime Rock Park",
      date: "2026-07-24",
      endDate: "2026-07-25",
      trackName: "Lime Rock Park",
      venue: "Lime Rock Park, Lakeville, CT",
      format: "7-hour + 8-hour enduros",
      description:
        "Lime Rock does not race on Sundays — see the facility rules on the track page before planning a tow.",
    },
    {
      name: "Virginia International Raceway",
      date: "2026-07-31",
      endDate: "2026-08-02",
      trackName: "Virginia International Raceway",
      venue: "Virginia International Raceway, Alton, VA",
      format: "Test day + 8-hour + 7-hour enduros",
    },
    {
      name: "Thompson Speedway Motorsports Park",
      date: "2026-08-22",
      trackName: "Thompson Speedway Motorsports Park",
      // The alternative is the outer oval.
      layoutName: "Road Course",
      venue: "Thompson Speedway Motorsports Park, Thompson, CT",
      format: "12-hour enduro",
    },
    {
      name: "Mid-Ohio Sports Car Course",
      date: "2026-09-04",
      endDate: "2026-09-06",
      trackName: "Mid-Ohio Sports Car Course",
      venue: "Mid-Ohio Sports Car Course, Lexington, OH",
      format: "Test day + 8-hour + 7-hour enduros",
    },
    {
      name: "Sebring International Raceway",
      date: "2026-09-19",
      endDate: "2026-09-20",
      trackName: "Sebring International Raceway",
      layoutName: "Full Course",
      venue: "Sebring International Raceway, Sebring, FL",
      format: "8-hour + 7-hour enduros",
    },
    {
      name: "Harris Hill Raceway",
      date: "2026-09-26",
      endDate: "2026-09-27",
      trackName: "Harris Hill Raceway",
      layoutName: "Full Course",
      venue: "Harris Hill Raceway, San Marcos, TX",
      format: "8-hour + 7-hour enduros",
    },
    {
      name: "Pocono Raceway",
      date: "2026-10-10",
      endDate: "2026-10-11",
      trackName: "Pocono Raceway",
      // Pocono has half a dozen infield road configurations and the directory
      // carries only the tri-oval, which this round certainly does not use.
      layoutName: null,
      venue: "Pocono Raceway, Long Pond, PA",
      format: "8-hour + 7-hour enduros",
      description:
        "Run on one of Pocono's infield road configurations. The published schedule does not say which, so this round is not linked to a circuit layout — check the event's supplementary regulations.",
    },
  ],

  /*
   * A summary, not the rule book. Each entry cites where it comes from so a
   * competitor can check it, and every one of them is subordinate to the
   * current BCCR and the event's supplementary regulations — which is stated
   * first, on purpose, because somebody reading a seeded summary and skipping
   * the source is the failure mode this whole section has.
   */
  rules: [
    {
      kind: SeriesRuleKind.OTHER,
      title: "This is a summary — the BCCR is the rule book",
      detail:
        "Everything here is a précis of the published Basic Club & Competition Rules, kept so you can plan a season at a glance. The BCCR is revised between seasons and supplementary regulations change per event. Read both before building a car or loading a trailer.",
      citation: "ChampCar BCCR",
      sourceUrl: BCCR,
      sortOrder: 0,
    },
    {
      kind: SeriesRuleKind.ELIGIBILITY,
      title: "Vehicle points cap: 500",
      detail:
        "Cars are rated under the Vehicle Performance Index rather than a dollar value. Each car carries a base point figure and modifications add points; the total may not exceed 500. Running over the cap is not a disqualification — it carries penalty laps, scaled to the length of the race.",
      citation: "BCCR — Vehicle Performance Index",
      sourceUrl: BCCR,
      sortOrder: 1,
    },
    {
      kind: SeriesRuleKind.ELIGIBILITY,
      title: "Penalty laps for exceeding the cap",
      detail:
        "One penalty lap per 10 points over 500, scaled by event duration. A car found over the cap can still race; it starts the weekend owing laps.",
      citation: "BCCR — Vehicle Performance Index",
      sourceUrl: BCCR,
      sortOrder: 2,
    },
    {
      kind: SeriesRuleKind.DRIVERS,
      title: "Minimum drivers by race length",
      detail:
        "At least two drivers for races of 8 hours or less, three for 9 to 16 hours, and four for 17 hours or longer. Plan the line-up against the format of the round you are entering — several 2026 rounds pair an 8-hour with a 7-hour race across one weekend.",
      citation: "BCCR — driver requirements",
      sourceUrl: BCCR,
      sortOrder: 1,
    },
    {
      kind: SeriesRuleKind.DRIVERS,
      title: "Maximum stint 2 hours, minimum 1 hour out of the car",
      detail:
        "No driver may run more than 2 hours in a single stint, and must have at least an hour out of the car before going back in. This is what makes the minimum driver counts binding rather than advisory.",
      citation: "BCCR — driver requirements",
      sourceUrl: BCCR,
      sortOrder: 2,
    },
    {
      kind: SeriesRuleKind.SAFETY,
      title: "Cage, seat, harness, fire suppression, window net, master switch",
      detail:
        "A compliant roll cage, racing seat and harnesses, an on-board fire suppression system, a window net and a master electrical cut-off are all required. Personal equipment — suit, helmet, restraint — is specified in the BCCR. Most of a ChampCar build's cost is here rather than in performance.",
      citation: "BCCR — safety requirements",
      sourceUrl: BCCR,
      sortOrder: 1,
    },
    {
      kind: SeriesRuleKind.FORMAT,
      title: "Multi-hour enduros, usually two per weekend",
      detail:
        "Most 2026 rounds run a pair of enduros across a weekend — commonly 8 hours on the Saturday and 7 on the Sunday. Single long races (12 and 14 hours) and an overnight round at Sebring are the exceptions. The format for each round is on its event page.",
      citation: "2026 schedule",
      sourceUrl: CHAMPCAR_SOURCE,
      sortOrder: 1,
    },
  ],
};
