import { SeriesDiscipline, SeriesRuleKind } from "@prisma/client";
import type { SeedSeries } from "./champcar.mts";

/**
 * The 24 Hours of Lemons, as a reference championship.
 *
 * The cheapest way into wheel-to-wheel racing in the United States, and the
 * one with the most distinctive rule book: a car has to be bought and prepared
 * for $500, judged by people who assume you are lying, and the top prize goes
 * to whoever does best in the least plausible machine.
 *
 * ## Accuracy, and what is deliberately not here
 *
 * Same standard as the ChampCar entry. Every figure is a summary of a
 * published source, cited so a reader can check it, and dated so a stale one
 * is visible as stale.
 *
 * Two deliberate omissions, both for the same reason — a wrong number here
 * costs somebody a build or a tow:
 *
 * - **No entry fees.** They vary per event and change between seasons.
 * - **No calendar.** Lemons runs somewhere over twenty races a year and the
 *   official schedule was not reachable when this was written, so the rounds
 *   could not be verified. Two events could be corroborated from third-party
 *   listings; seeding two rounds of a twenty-three-round season would read as
 *   the season, which is worse than seeding none. The series description
 *   points at the published schedule instead.
 *
 * One thing is stated but not seeded as a rule: the *People's Curse*, the
 * award that had a car crushed by the crowd's vote. It is the series' most
 * famous piece of folklore and it was dropped in 2013, so listing it among
 * current regulations would be repeating a story as a rule.
 *
 * Sources:
 * - https://24hoursoflemons.com/prices-rules/ — the rule book
 * - https://24hoursoflemons.com/safety-checklist/ — safety checklist
 * - https://24hoursoflemons.com/schedule/ — the season calendar
 * - Hagerty, "Every 24 Hours of Lemons question answered"
 * - Wikipedia, "24 Hours of Lemons" and "Index of Effluency"
 */

export const LEMONS_SOURCE = "https://24hoursoflemons.com/";
const RULES = "https://24hoursoflemons.com/prices-rules/";
const SAFETY = "https://24hoursoflemons.com/safety-checklist/";
const SCHEDULE = "https://24hoursoflemons.com/schedule/";
/** When these entries were last checked against the published sources. */
const CHECKED = "2026-08-07";

export const LEMONS: SeedSeries = {
  name: "24 Hours of Lemons",
  slug: "24-hours-of-lemons",
  discipline: SeriesDiscipline.REAL_WORLD,
  platform: "Circuit",
  season: "2026",
  description:
    "Endurance racing for cars bought and prepared for $500, running since 2006 at road courses across the United States. Most events are twelve to sixteen hours of racing split over two days, with at least one true round-the-clock race a season.\n\nThe $500 is the whole point and it is enforced by judgement rather than receipts: a panel of BS Judges looks at the car, your story about it and whatever paperwork you brought, and prices anything they do not believe. The overall win matters less here than the Index of Effluency, which goes to whoever got furthest in the least likely car.\n\nThis is a reference copy of the rule book, seeded so you can work out what a car would take before you enter one. The calendar is not seeded — Lemons runs over twenty races a year and the schedule moves, so check the published one.",
  sourceUrl: LEMONS_SOURCE,
  checkedOn: CHECKED,

  /*
   * Deliberately empty. See the note at the top of this file: the official
   * schedule could not be reached when this was written, and a partial
   * calendar for a twenty-three-round season would be read as the season.
   */
  events: [],

  /*
   * A summary, not the rule book. Ordered so the caveat comes first and the
   * money rule — the one everybody arrives asking about — comes second.
   */
  rules: [
    {
      kind: SeriesRuleKind.OTHER,
      title: "This is a summary — the Lemons rulebook is the rule book",
      detail:
        "Everything here is a précis of the published rules, kept so you can work out what a car would take at a glance. Lemons revises its rules between seasons and each event has its own supplementary regulations. Read both before building a car or loading a trailer — and note that the judges are explicitly allowed to use their judgement, so no summary can tell you what they will decide.",
      citation: "24 Hours of Lemons rules",
      sourceUrl: RULES,
      sortOrder: 0,
    },
    {
      kind: SeriesRuleKind.OTHER,
      title: "The Index of Effluency is the prize that matters",
      detail:
        "The overall win is not the headline award. The Index of Effluency goes to the team that got the furthest in the least likely car — weighed on age, hopelessness, country of origin and general improbability, plus the organizers' whim. It is worth building for: a car with no realistic shot at the overall result has a very real shot at this.",
      citation: "24 Hours of Lemons — Index of Effluency",
      sourceUrl: LEMONS_SOURCE,
      sortOrder: 1,
    },

    {
      kind: SeriesRuleKind.ELIGIBILITY,
      title: "The car costs $500, safety equipment excluded",
      detail:
        "A car has to be acquired and prepared for no more than $500, not counting safety equipment. The line the rules draw is that \"safety\" means things that save the *driver*, not things that save the car — so a cage is exempt and a stronger gearbox is not.",
      citation: "Lemons rules — the $500 limit",
      sourceUrl: RULES,
      sortOrder: 1,
    },
    {
      kind: SeriesRuleKind.ELIGIBILITY,
      title: "What does not count towards the $500",
      detail:
        "Wheels, tyres, wheel bearings, ball joints and brake components. Exhaust downstream of the header or manifold — but turbochargers and their plumbing are *not* exempt. Windscreens and wipers. Driver comfort and information: steering wheel, shifter, gauges, pedals, cool suits, vents, heaters, radio. Fuel hoses, fittings, filters and mounts, and fuel-system components upstream of the pump including tanks, cells, fillers and vents — but fuel pumps, carburettors, injection pumps, engine computers and individual injectors are *not* exempt.",
      citation: "Lemons rules — budget exemptions",
      sourceUrl: RULES,
      sortOrder: 2,
    },
    {
      kind: SeriesRuleKind.ELIGIBILITY,
      title: "Mass-produced road cars only, under 4,200 lb",
      detail:
        "Entries must be mass-produced four-wheeled vehicles that were legal for US road use when they were built, with a manufacturer's stated kerb weight no greater than 4,200 lb. That rules out purpose-built racing cars and anything built to a racing formula rather than sold to the public. The rule book also names the obvious: no Peterbilts, Zambonis, sidecars or golf carts.",
      citation: "Lemons rules — vehicle eligibility",
      sourceUrl: RULES,
      sortOrder: 3,
    },
    {
      kind: SeriesRuleKind.ENTRY,
      title: "BS Inspection: the judges price what they do not believe",
      detail:
        "Every car goes in front of a panel of BS Judges, who assess the car, the story you tell about it and whatever documentation you brought. Parts outside the safety exemptions with no paper trail and no plausible account get a price assigned by the judges. They are reported to be lenient with teams racing in the spirit of the thing — a junkyard replacement engine after a blow-up draws few questions — and unforgiving with teams who look like they are trying it on.",
      citation: "Lemons rules — BS Inspection",
      sourceUrl: RULES,
      sortOrder: 1,
    },

    {
      kind: SeriesRuleKind.SCORING,
      title: "Penalty laps: one for every $10 over $500",
      detail:
        "Going over the cap does not put you out. The judges assess what they think the car cost and the team starts the race that many laps down — one lap per $10 over. A car judged at $550 starts five laps behind.",
      citation: "Lemons rules — budget penalties",
      sourceUrl: RULES,
      sortOrder: 1,
    },
    {
      kind: SeriesRuleKind.FORMAT,
      title: "Three classes, and Class C is where the glory is",
      detail:
        "Cars are placed in Class A, B or C by the judges. A is capable of an overall win, B is slower or less durable, and C is the hopeless class — old British cars, land yachts, diesels, and anything else with no business on a circuit. Class C is where the Index of Effluency effectively lives; a car outside it has little realistic claim on the award.",
      citation: "Lemons rules — classing",
      sourceUrl: RULES,
      sortOrder: 2,
    },
    {
      kind: SeriesRuleKind.FORMAT,
      title: "Twelve to sixteen hours over two days, and one real 24",
      detail:
        "Despite the name, most rounds are twelve to sixteen hours of racing split across a Saturday and a Sunday, typically mid-morning to early evening on each. At least one event a season is a genuine round-the-clock race, running from the middle of Saturday through the night to Sunday.",
      citation: "24 Hours of Lemons — race format",
      sourceUrl: SCHEDULE,
      sortOrder: 3,
    },
    {
      kind: SeriesRuleKind.DRIVERS,
      title: "Four drivers or more",
      detail:
        "Teams run four or more drivers over the weekend. Stint lengths are the team's own call rather than a regulated maximum — typically anywhere from about ninety minutes to a couple of hours, decided by fuel range and how much everyone wants a turn.",
      citation: "24 Hours of Lemons — teams",
      sourceUrl: RULES,
      sortOrder: 1,
    },

    {
      kind: SeriesRuleKind.SAFETY,
      title: "Cage, seat, harness, kill switch and fire suppression",
      detail:
        "A six-point or better roll cage with a full front and rear hoop properly braced, dual door bars on each side, at least two main-hoop backstays, at least one main-hoop diagonal, spreader plates and gussets where required, and complete 360-degree welds at every joint. Plus a racing seat, a five- or six-point harness, an electrical kill switch, and on-board fire suppression. This is where a Lemons budget actually goes — none of it counts against the $500.",
      citation: "Lemons safety checklist",
      sourceUrl: SAFETY,
      sortOrder: 1,
    },
    {
      kind: SeriesRuleKind.SAFETY,
      title: "Driver kit: fire suit head to toe, full-face helmet, head restraint",
      detail:
        "An SFI 3.2A/1 fire suit with fire-resistant gloves, shoes and underwear; a full-face helmet — open-face is not accepted — carrying a current Snell SA rating; and a head-and-neck restraint to SFI 38.1 or FIA 8858. Snell and SFI ratings roll on a cycle and the accepted ones change, so check the current checklist rather than this page before buying a helmet.",
      citation: "Lemons safety checklist",
      sourceUrl: SAFETY,
      sortOrder: 2,
    },

    {
      kind: SeriesRuleKind.CONDUCT,
      title: "Black flags, and what the fifth one costs",
      detail:
        "Black flags are handed out freely: wheels off the circuit, a spin, passing under yellow, contact with a car or a barrier, overly aggressive driving, or speeding in the pit lane. A black flag means an immediate stop and a trip to the judges, who hand down penalties that are usually more embarrassing than they are quick. They escalate — a fourth black flag in a day adds a mandatory multi-hour penalty on top, and a fifth puts the whole team out for the rest of the race.",
      citation: "Lemons rules — on-track conduct",
      sourceUrl: RULES,
      sortOrder: 1,
    },
  ],
};
