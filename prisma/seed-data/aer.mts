import { SeriesDiscipline, SeriesRuleKind } from "@prisma/client";
import type { SeedSeries } from "./champcar.mts";

/**
 * American Endurance Racing, as a reference championship.
 *
 * The third of the shipped budget-endurance series and the one that solves the
 * classing problem differently from the other two. ChampCar rates a car on a
 * points sheet before it turns a wheel and Lemons has judges price it; AER
 * lets everyone qualify on the Friday and then draws the class boundaries
 * around the lap times it actually sees. That means the car you already own —
 * built to whatever sanctioning body's rules you already race under — is
 * eligible, and finding your class is a session rather than a spreadsheet.
 *
 * ## Accuracy, and what is deliberately not here
 *
 * Same standard as the other two. Every figure is a summary of a published
 * source, cited so a reader can check it, and dated so a stale one is visible
 * as stale.
 *
 * - **No entry fees.** They are published per event and change between
 *   seasons; a stale one costs somebody real money. Standing rule across all
 *   three seeded series.
 * - **No circuit configurations.** AER's calendar names venues rather than
 *   layouts, so every round here falls back to the circuit's primary layout
 *   and says on the event that the configuration is unconfirmed.
 * - **The calendar may be incomplete.** The official events list was not
 *   reachable when this was written; the five rounds below were corroborated
 *   from event pages and each one lands on the Friday–Sunday pattern the
 *   series publishes, which is the check that made them worth seeding. Unlike
 *   Lemons — where two rounds out of twenty-odd would have read as the season
 *   — five is a substantial share of an AER year, and the description says to
 *   check for more.
 *
 * Sources:
 * - https://americanenduranceracing.com/ — the series
 * - https://race.americanenduranceracing.com/rulebook — the rulebook
 * - https://americanenduranceracing.com/calendar/ — the season calendar
 * - https://americanenduranceracing.com/get-started/ — driver and car eligibility
 */

export const AER_SOURCE = "https://americanenduranceracing.com/";
const RULEBOOK = "https://race.americanenduranceracing.com/rulebook";
const GET_STARTED = "https://americanenduranceracing.com/get-started/";
const CALENDAR = "https://americanenduranceracing.com/calendar/";
/** When these entries were last checked against the published sources. */
const CHECKED = "2026-08-07";

export const AER: SeedSeries = {
  name: "American Endurance Racing",
  slug: "american-endurance-racing",
  discipline: SeriesDiscipline.REAL_WORLD,
  platform: "Circuit",
  season: "2026",
  description:
    "Endurance racing for experienced drivers in production-based cars, run as three-day weekends: practice and a two-hour qualifying race on the Friday, then eight-hour races on Saturday and Sunday.\n\nWhat makes AER different from the other budget enduro series is that nobody rates your car in advance. Everybody qualifies, and the classes are drawn around the lap times that come out of it — three to five of them depending on how big the field is. So the car you already race under SCCA, NASA or club rules is eligible as it stands, and where it ends up is decided by how quick it actually goes.\n\nThis is a reference copy of the rule book and the calendar. The calendar may be incomplete — check the published one before planning a season.",
  sourceUrl: AER_SOURCE,
  checkedOn: CHECKED,

  /*
   * Venues only: AER publishes the circuit but not the configuration, so every
   * round below leaves `layoutName` off and the loader links the primary
   * layout with a note saying the configuration is unconfirmed.
   */
  events: [
    {
      name: "AER at Watkins Glen",
      date: "2026-05-01",
      endDate: "2026-05-03",
      trackName: "Watkins Glen International",
      venue: "Watkins Glen International, Watkins Glen, NY",
      format: "Friday 2-hour qualifying race + 8-hour races Saturday and Sunday",
    },
    {
      name: "AER at VIR",
      date: "2026-05-29",
      endDate: "2026-05-31",
      trackName: "Virginia International Raceway",
      venue: "Virginia International Raceway, Alton, VA",
      format: "Friday 2-hour qualifying race + 8-hour races Saturday and Sunday",
    },
    {
      name: "AER at Summit Point",
      date: "2026-06-26",
      endDate: "2026-06-28",
      trackName: "Summit Point Motorsports Park",
      venue: "Summit Point Motorsports Park, Summit Point, WV",
      format: "Friday 2-hour qualifying race + 8-hour races Saturday and Sunday",
    },
    {
      name: "AER at Mid-Ohio",
      date: "2026-10-16",
      endDate: "2026-10-18",
      trackName: "Mid-Ohio Sports Car Course",
      venue: "Mid-Ohio Sports Car Course, Lexington, OH",
      format: "Friday 2-hour qualifying race + 8-hour races Saturday and Sunday",
    },
    {
      name: "AER at NJMP",
      date: "2026-11-13",
      endDate: "2026-11-14",
      trackName: "New Jersey Motorsports Park",
      venue: "New Jersey Motorsports Park, Millville, NJ",
      format: "Friday qualifying race + a single 14-hour race on Saturday",
      description:
        "A two-day round rather than the usual three: one long race on the Saturday instead of a pair of eight-hour races.",
    },
  ],

  /*
   * A summary, not the rule book. The classing rule comes first after the
   * caveat because it is the thing that decides whether somebody's existing
   * car is worth entering, which is the first question anyone asks of AER.
   */
  rules: [
    {
      kind: SeriesRuleKind.OTHER,
      title: "This is a summary — the AER rulebook is the rule book",
      detail:
        "Everything here is a précis of the published rulebook, kept so you can work out whether your car and your drivers qualify at a glance. AER revises the rulebook between seasons and each event carries its own supplementary regulations. Read both before entering.",
      citation: "AER rulebook",
      sourceUrl: RULEBOOK,
      sortOrder: 0,
    },

    {
      kind: SeriesRuleKind.FORMAT,
      title: "Classes are drawn from Friday's lap times, not from a rule sheet",
      detail:
        "There is no pre-race rating of your car. Everybody runs the Friday qualifying race, and AER then groups cars with similar lap times into classes — aiming for three to five of them depending on how big the field is. A quick car races quick cars. It also means you cannot game the class by building to a number, because the number is your own lap time.",
      citation: "AER rulebook — classing",
      sourceUrl: RULEBOOK,
      sortOrder: 1,
    },
    {
      kind: SeriesRuleKind.FORMAT,
      title: "Three days: qualifying race Friday, eight hours Saturday and Sunday",
      detail:
        "A typical AER weekend is HPDE and practice plus a two-hour qualifying race on the Friday, then an eight-hour race on each of Saturday and Sunday. Race lengths are set in multiples of 90 minutes. Some rounds vary — one 2026 round runs a single fourteen-hour race on the Saturday instead — so check the round you are entering.",
      citation: "AER — event format",
      sourceUrl: CALENDAR,
      sortOrder: 2,
    },
    {
      kind: SeriesRuleKind.FORMAT,
      title: "Minimum pit stops: race minutes divided by 90, minus one",
      detail:
        "The stop count is a formula rather than a fixed number, so it scales with the race. A nine-hour race is 540 minutes: 540 ÷ 90 = 6, minus 1 = five required stops. Work it out for your round before building a fuel plan around it.",
      citation: "AER rulebook — pit stops",
      sourceUrl: RULEBOOK,
      sortOrder: 3,
    },
    {
      kind: SeriesRuleKind.FORMAT,
      title: "Rolling starts, gridded on what you did last",
      detail:
        "Saturday's race rolls off in qualifying order. On a two-race weekend, Sunday rolls off in Saturday's finishing order — so Saturday's result is worth having beyond the points.",
      citation: "AER rulebook — starts",
      sourceUrl: RULEBOOK,
      sortOrder: 4,
    },
    {
      kind: SeriesRuleKind.SCORING,
      title: "Multi-class: scored in class and overall, on laps",
      detail:
        "Every AER race is a multi-class race. Cars are scored against the others in their class and against the whole field for the overall, both on laps completed.",
      citation: "AER rulebook — scoring",
      sourceUrl: RULEBOOK,
      sortOrder: 1,
    },

    {
      kind: SeriesRuleKind.ELIGIBILITY,
      title: "Bring the car you already race",
      detail:
        "Any production-based race car built to compete under SCCA, NASA, BMW CCA, PCA, PBOC, IMSA, World Challenge or a similar sanctioning body is eligible, as are top-tier ChampCar cars including EC, and Class A Lemons cars. There is no AER-specific build standard to meet — the point is that a car already legal somewhere else can enter as it stands, and the Friday qualifying race sorts out where it belongs.",
      citation: "AER — car eligibility",
      sourceUrl: GET_STARTED,
      sortOrder: 1,
    },
    {
      kind: SeriesRuleKind.ELIGIBILITY,
      title: "DOT street tyres, 180 treadwear minimum",
      detail:
        "All cars run DOT-approved street tyres with a treadwear rating of at least 180. This is the one place AER does constrain the car, and it is what keeps a lap-time-based classing system from becoming a tyre-budget contest.",
      citation: "AER rulebook — tyres",
      sourceUrl: RULEBOOK,
      sortOrder: 2,
    },
    {
      kind: SeriesRuleKind.SAFETY,
      title: "Built to another body's standard, and able to prove it",
      detail:
        "Cars must be safe enough to pass technical inspection with NASA, SCCA, BMW Club Racing or an equivalent body. AER does not publish a separate cage specification — it defers to the standard your car was built to, which is the other half of letting people bring what they already race. Check the rulebook for the current requirements before your first event.",
      citation: "AER rulebook — safety",
      sourceUrl: RULEBOOK,
      sortOrder: 1,
    },
    {
      kind: SeriesRuleKind.DRIVERS,
      title: "Experienced drivers only",
      detail:
        "AER is explicitly not a place to learn. Drivers need a current or former competition licence from a major sanctioning body, or five or more Lemons or ChampCar races, or substantial comparable track time. If you are coming from HPDE alone, this is not the series to start in.",
      citation: "AER — driver eligibility",
      sourceUrl: GET_STARTED,
      sortOrder: 1,
    },
  ],
};
