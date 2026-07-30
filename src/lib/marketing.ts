/**
 * Landing-page content, kept as data rather than inline JSX.
 *
 * RaceOps is not a sim-to-real pipeline with extras bolted on — it is the
 * operating platform for motorsport, sim and real world alike. People arrive
 * wanting to do one specific thing (run a championship, fill a seat, work a
 * race weekend, place sponsorship money), so the page leads with those jobs
 * instead of a feature list.
 */

export interface AudiencePath {
  /** Verb-first: what the visitor came to do. */
  action: string;
  audience: string;
  body: string;
  href: string;
  cta: string;
}

/** The jobs people come here to do, in rough order of platform depth. */
export const AUDIENCE_PATHS: AudiencePath[] = [
  {
    action: "Run a championship",
    audience: "Series organizers",
    body: "Build the calendar, take entries, publish regulations, score the championship, and rule on penalties and appeals — one console for the whole season.",
    href: "/series",
    cta: "Start a series",
  },
  {
    action: "Run a race weekend",
    audience: "Event organizers & race control",
    body: "Multi-day running orders, live timing with flags, entry lists, volunteer rosters, bulletins and post-race results.",
    href: "/events",
    cta: "See events",
  },
  {
    action: "Run a race team",
    audience: "Team owners & managers",
    body: "Drivers and crew on the books, the season calendar, entries, championship position, and your sponsorship pipeline in one place.",
    href: "/teams",
    cta: "Set up your team",
  },
  {
    action: "Find a race seat",
    audience: "Drivers",
    body: "Seats posted by real teams across sim and real-world series. One profile carries your record to every application.",
    href: "/opportunities",
    cta: "Find a seat",
  },
  {
    action: "Find crew work",
    audience: "Engineers, mechanics & strategists",
    body: "Race engineer, data, mechanic, tire, spotter and strategist roles — tagged by what you actually do, so the right jobs find you.",
    href: "/opportunities",
    cta: "Browse crew jobs",
  },
  {
    action: "Work a race weekend",
    audience: "Marshals, scrutineers & officials",
    body: "Volunteer shifts posted by organizers with the roles and hours they need covered. Sign up, get confirmed, get reminded.",
    href: "/events",
    cta: "Find shifts",
  },
  {
    action: "Place or raise sponsorship",
    audience: "Sponsors & commercial teams",
    body: "Sponsors pitch teams directly and track every offer; teams manage offers, active deals and committed value on their own books.",
    href: "/opportunities",
    cta: "Explore sponsorship",
  },
  {
    action: "Get discovered",
    audience: "Everyone in the paddock",
    body: "One profile for sim results, real-world licences and industry experience, tagged by role across both worlds and searchable by anyone hiring.",
    href: "/search",
    cta: "Discover people",
  },
];

export interface CapabilityGroup {
  title: string;
  lede: string;
  bullets: string[];
  href: string;
  cta: string;
}

/** What the platform actually does, grouped by who operates it. */
export const CAPABILITY_GROUPS: CapabilityGroup[] = [
  {
    title: "Series & event operations",
    lede: "Everything an organizer needs to put a championship on, from the first entry to the final classification.",
    bullets: [
      "Organizer roster with owner, admin, race control, steward and volunteer coordinator roles",
      "Draft → published → completed event lifecycle with registration windows, entry caps, unique car numbers and automatic waitlisting",
      "Multi-day running orders: scrutineering, practice, qualifying, race, briefings and support races",
      "Live timing boards with flag state, gaps, laps down and session fastest lap",
      "Rule books, supplementary regs, tech sheets and bulletins with revision control and public / entrant / organizer visibility",
      "Championship standings on a configurable points scheme, with penalties, appeals and a public decision record",
      "Bulk results import from your timing system, previewed as a dry run before it writes",
    ],
    href: "/series",
    cta: "Run a series",
  },
  {
    title: "Team operations",
    lede: "A race team is a business as much as a car. Run both from the same console.",
    bullets: [
      "Drivers and staff on one roster, with roles that decide who can do what",
      "The season calendar built from your actual entries — enter, withdraw, track confirmation",
      "Championship position and every result across every series you race in",
      "Penalties against your entries visible on your own page, deductions reflected in your points",
      "Sponsorship offers, active deals and committed value, kept to the team",
      "A private team chat room alongside the event paddock chat",
    ],
    href: "/teams",
    cta: "Set up a team",
  },
  {
    title: "Careers & opportunities",
    lede: "The paddock runs on who you know. This is the part that fixes that.",
    bullets: [
      "Race seats, crew jobs and sponsorship posted by teams and individuals",
      "Role tags for what you actually do — race engineer, tire tech, scrutineer, livery artist, commentator — separately for sim and real world",
      "Applications tracked end to end, with poster-side review",
      "Volunteer shifts for marshals, flag, timing, scrutineering and medical, with per-shift capacity and waitlists",
      "Endorsements and verification so a claim on a profile means something",
    ],
    href: "/opportunities",
    cta: "Browse opportunities",
  },
];

/** The two worlds, treated as peers rather than a funnel. */
export const DISCIPLINE_POINTS: { title: string; body: string }[] = [
  {
    title: "Sim racing is not a stepping stone",
    body: "Leagues run real championships with real stewarding, real sponsorship and real careers. Every organizer, timing, penalty and standings tool here works the same whether the grid is on iRacing or on a circuit.",
  },
  {
    title: "Real-world racing is not a separate app",
    body: "Club meetings, karting, endurance and national series get the same running orders, scrutineering slots, marshal rosters and regulation libraries — built for a paddock that runs on paper today.",
  },
  {
    title: "One record across both",
    body: "Your profile carries sim results, competition licences and industry experience together, tagged by role in each world. A team hiring a data engineer can see all of it in one place.",
  },
];

/** Every internal destination the landing page links to. */
export function marketingLinks(): string[] {
  return [
    ...AUDIENCE_PATHS.map((path) => path.href),
    ...CAPABILITY_GROUPS.map((group) => group.href),
  ];
}
