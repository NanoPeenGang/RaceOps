import { TrackDirection, TrackKind } from "@prisma/client";

/**
 * Reference tracks for the lower 48 US states.
 *
 * Seeded so a new deployment is not an empty directory — the first organizer
 * to schedule a round should find their circuit already there rather than
 * having to type it in, because a venue nobody bothers to add is a venue whose
 * lap records never accumulate.
 *
 * Scope, per the brief: road courses, permanent circuits and ovals. Drag
 * strips, karting-only facilities and autocross sites are left out. Dirt ovals
 * are included where a state has little else, since a dirt half-mile is a real
 * venue people run championships at, and the surface is noted.
 *
 * ## On accuracy
 *
 * Lap records and cross-series comparison hang off this data, so a wrong
 * length is worse than a missing one. Lengths are given only where they are
 * well established, and omitted rather than guessed — `formatLength` already
 * renders nothing for a null, and a track with no length is obviously
 * incomplete, whereas a track with a plausible wrong length looks correct.
 *
 * Every entry is editable in-app by anyone signed in, with the change audited,
 * precisely because a static list like this goes stale: circuits repave,
 * reconfigure, change name with a sponsor, and close.
 *
 * Not every state has two to five paved circuits. Rhode Island has no active
 * permanent road course or oval at all and is deliberately absent rather than
 * padded out with something that is not one.
 */

export interface SeedLayout {
  name: string;
  /** Metres. Omitted where the figure is not well established. */
  lengthMeters?: number;
  direction?: TrackDirection;
  isPrimary?: boolean;
  notes?: string;
}

export interface SeedTrack {
  name: string;
  kind: TrackKind;
  city: string;
  /** Two-letter US state, stored on `Track.region`. */
  state: string;
  licenceGrade?: string;
  notes?: string;
  layouts: SeedLayout[];
}

/** Miles to metres, rounded — the unit US circuits publish. */
const mi = (miles: number): number => Math.round(miles * 1609.344);

const CW = TrackDirection.CLOCKWISE;
const CCW = TrackDirection.ANTICLOCKWISE;

export const US_REFERENCE_TRACKS: SeedTrack[] = [
  // -- Alabama ---------------------------------------------------------------
  {
    name: "Barber Motorsports Park",
    kind: TrackKind.CIRCUIT,
    city: "Birmingham",
    state: "AL",
    licenceGrade: "FIA Grade 2",
    layouts: [{ name: "Grand Prix", lengthMeters: mi(2.38), direction: CW, isPrimary: true }],
  },
  {
    name: "Talladega Superspeedway",
    kind: TrackKind.OVAL,
    city: "Lincoln",
    state: "AL",
    notes: "Tri-oval with 33-degree banking; the fastest oval in NASCAR.",
    layouts: [{ name: "Superspeedway", lengthMeters: mi(2.66), direction: CCW, isPrimary: true }],
  },
  {
    name: "Mobile International Speedway",
    kind: TrackKind.OVAL,
    city: "Irvington",
    state: "AL",
    layouts: [{ name: "Oval", lengthMeters: mi(0.5), direction: CCW, isPrimary: true }],
  },

  // -- Arizona ---------------------------------------------------------------
  {
    name: "Phoenix Raceway",
    kind: TrackKind.OVAL,
    city: "Avondale",
    state: "AZ",
    notes: "Low-banked tri-oval with a distinctive dogleg on the back straight.",
    layouts: [
      { name: "Oval", lengthMeters: mi(1.0), direction: CCW, isPrimary: true },
      { name: "Road Course", lengthMeters: mi(1.51), direction: CW },
    ],
  },
  {
    name: "Inde Motorsports Ranch",
    kind: TrackKind.CIRCUIT,
    city: "Willcox",
    state: "AZ",
    layouts: [{ name: "Full Course", lengthMeters: mi(2.75), isPrimary: true }],
  },
  {
    name: "Tucson Speedway",
    kind: TrackKind.OVAL,
    city: "Tucson",
    state: "AZ",
    layouts: [{ name: "Oval", lengthMeters: mi(0.375), direction: CCW, isPrimary: true }],
  },

  // -- Arkansas --------------------------------------------------------------
  {
    name: "Batesville Motor Speedway",
    kind: TrackKind.OVAL,
    city: "Locust Grove",
    state: "AR",
    notes: "Dirt oval.",
    layouts: [{ name: "Oval", lengthMeters: mi(0.375), direction: CCW, isPrimary: true }],
  },
  {
    name: "I-30 Speedway",
    kind: TrackKind.OVAL,
    city: "Little Rock",
    state: "AR",
    notes: "Dirt oval.",
    layouts: [{ name: "Oval", direction: CCW, isPrimary: true }],
  },

  // -- California ------------------------------------------------------------
  {
    name: "WeatherTech Raceway Laguna Seca",
    kind: TrackKind.CIRCUIT,
    city: "Monterey",
    state: "CA",
    licenceGrade: "FIA Grade 2",
    notes: "The Corkscrew drops roughly 59 feet over turns 8 and 8A.",
    layouts: [{ name: "Grand Prix", lengthMeters: mi(2.238), direction: CW, isPrimary: true }],
  },
  {
    name: "Sonoma Raceway",
    kind: TrackKind.CIRCUIT,
    city: "Sonoma",
    state: "CA",
    layouts: [
      { name: "Grand Prix", lengthMeters: mi(2.52), direction: CW, isPrimary: true },
      { name: "NASCAR Course", lengthMeters: mi(1.99), direction: CW },
    ],
  },
  {
    name: "Thunderhill Raceway Park",
    kind: TrackKind.CIRCUIT,
    city: "Willows",
    state: "CA",
    notes: "Home of the 25 Hours of Thunderhill.",
    layouts: [
      { name: "5 Mile", lengthMeters: mi(5.0), isPrimary: true },
      { name: "West (3 Mile)", lengthMeters: mi(3.0) },
      { name: "East (2 Mile)", lengthMeters: mi(2.0) },
    ],
  },
  {
    name: "Buttonwillow Raceway Park",
    kind: TrackKind.CIRCUIT,
    city: "Buttonwillow",
    state: "CA",
    layouts: [{ name: "Configuration 13", lengthMeters: mi(3.0), isPrimary: true }],
  },
  {
    name: "Willow Springs International Raceway",
    kind: TrackKind.CIRCUIT,
    city: "Rosamond",
    state: "CA",
    notes: "Opened 1953; among the oldest permanent road courses in the US.",
    layouts: [
      { name: "Big Willow", lengthMeters: mi(2.5), direction: CCW, isPrimary: true },
      { name: "Streets of Willow", lengthMeters: mi(1.8) },
    ],
  },

  // -- Colorado --------------------------------------------------------------
  {
    name: "Pikes Peak International Raceway",
    kind: TrackKind.OVAL,
    city: "Fountain",
    state: "CO",
    layouts: [{ name: "Oval", lengthMeters: mi(1.0), direction: CCW, isPrimary: true }],
  },
  {
    name: "High Plains Raceway",
    kind: TrackKind.CIRCUIT,
    city: "Deer Trail",
    state: "CO",
    layouts: [{ name: "Full Course", lengthMeters: mi(2.55), isPrimary: true }],
  },
  {
    name: "Pueblo Motorsports Park",
    kind: TrackKind.CIRCUIT,
    city: "Pueblo",
    state: "CO",
    layouts: [{ name: "Road Course", lengthMeters: mi(2.2), isPrimary: true }],
  },
  {
    name: "Colorado National Speedway",
    kind: TrackKind.OVAL,
    city: "Dacono",
    state: "CO",
    layouts: [{ name: "Oval", lengthMeters: mi(0.375), direction: CCW, isPrimary: true }],
  },

  // -- Connecticut -----------------------------------------------------------
  {
    name: "Lime Rock Park",
    kind: TrackKind.CIRCUIT,
    city: "Lakeville",
    state: "CT",
    notes: "No Sunday racing, by long-standing local ordinance.",
    layouts: [
      { name: "Full Course", lengthMeters: mi(1.53), direction: CW, isPrimary: true },
      { name: "Classic Course", lengthMeters: mi(1.5), direction: CW },
    ],
  },
  {
    name: "Thompson Speedway Motorsports Park",
    kind: TrackKind.CIRCUIT,
    city: "Thompson",
    state: "CT",
    layouts: [
      { name: "Road Course", lengthMeters: mi(1.7), isPrimary: true },
      { name: "Oval", lengthMeters: mi(0.625), direction: CCW },
    ],
  },
  {
    name: "Stafford Motor Speedway",
    kind: TrackKind.OVAL,
    city: "Stafford Springs",
    state: "CT",
    layouts: [{ name: "Oval", lengthMeters: mi(0.5), direction: CCW, isPrimary: true }],
  },
  {
    name: "New London-Waterford Speedbowl",
    kind: TrackKind.OVAL,
    city: "Waterford",
    state: "CT",
    layouts: [{ name: "Oval", lengthMeters: mi(0.375), direction: CCW, isPrimary: true }],
  },

  // -- Delaware --------------------------------------------------------------
  {
    name: "Dover Motor Speedway",
    kind: TrackKind.OVAL,
    city: "Dover",
    state: "DE",
    notes: "Concrete surface, 24-degree banking; known as the Monster Mile.",
    layouts: [{ name: "Oval", lengthMeters: mi(1.0), direction: CCW, isPrimary: true }],
  },
  {
    name: "Delaware International Speedway",
    kind: TrackKind.OVAL,
    city: "Delmar",
    state: "DE",
    notes: "Dirt oval.",
    layouts: [{ name: "Oval", lengthMeters: mi(0.5), direction: CCW, isPrimary: true }],
  },
  {
    name: "Georgetown Speedway",
    kind: TrackKind.OVAL,
    city: "Georgetown",
    state: "DE",
    notes: "Dirt oval.",
    layouts: [{ name: "Oval", lengthMeters: mi(0.5), direction: CCW, isPrimary: true }],
  },

  // -- Florida ---------------------------------------------------------------
  {
    name: "Daytona International Speedway",
    kind: TrackKind.OVAL,
    city: "Daytona Beach",
    state: "FL",
    licenceGrade: "FIA Grade 2",
    notes: "31-degree banking; hosts the Daytona 500 and the Rolex 24.",
    layouts: [
      { name: "Tri-Oval", lengthMeters: mi(2.5), direction: CCW, isPrimary: true },
      { name: "Sports Car Course", lengthMeters: mi(3.56), direction: CW },
    ],
  },
  {
    name: "Sebring International Raceway",
    kind: TrackKind.CIRCUIT,
    city: "Sebring",
    state: "FL",
    licenceGrade: "FIA Grade 2",
    notes: "Partly original airfield concrete; famously bumpy.",
    layouts: [{ name: "Full Course", lengthMeters: mi(3.74), direction: CW, isPrimary: true }],
  },
  {
    name: "Homestead-Miami Speedway",
    kind: TrackKind.OVAL,
    city: "Homestead",
    state: "FL",
    notes: "Variable banking, 18 to 20 degrees.",
    layouts: [{ name: "Oval", lengthMeters: mi(1.5), direction: CCW, isPrimary: true }],
  },
  {
    name: "Palm Beach International Raceway",
    kind: TrackKind.CIRCUIT,
    city: "Jupiter",
    state: "FL",
    layouts: [{ name: "Road Course", lengthMeters: mi(2.034), isPrimary: true }],
  },

  // -- Georgia ---------------------------------------------------------------
  {
    name: "Michelin Raceway Road Atlanta",
    kind: TrackKind.CIRCUIT,
    city: "Braselton",
    state: "GA",
    licenceGrade: "FIA Grade 2",
    notes: "Home of Petit Le Mans.",
    layouts: [{ name: "Full Course", lengthMeters: mi(2.54), direction: CW, isPrimary: true }],
  },
  {
    name: "Atlanta Motor Speedway",
    kind: TrackKind.OVAL,
    city: "Hampton",
    state: "GA",
    notes: "Reconfigured in 2022 to 28-degree banking and a narrower surface.",
    layouts: [{ name: "Quad-Oval", lengthMeters: mi(1.54), direction: CCW, isPrimary: true }],
  },
  {
    name: "Roebling Road Raceway",
    kind: TrackKind.CIRCUIT,
    city: "Bloomingdale",
    state: "GA",
    layouts: [{ name: "Full Course", lengthMeters: mi(2.02), direction: CW, isPrimary: true }],
  },
  {
    name: "Atlanta Motorsports Park",
    kind: TrackKind.CIRCUIT,
    city: "Dawsonville",
    state: "GA",
    notes: "Layout by Hermann Tilke.",
    layouts: [{ name: "Full Course", lengthMeters: mi(2.0), isPrimary: true }],
  },

  // -- Idaho -----------------------------------------------------------------
  {
    name: "Meridian Speedway",
    kind: TrackKind.OVAL,
    city: "Meridian",
    state: "ID",
    layouts: [{ name: "Oval", lengthMeters: mi(0.25), direction: CCW, isPrimary: true }],
  },
  {
    name: "Magic Valley Speedway",
    kind: TrackKind.OVAL,
    city: "Twin Falls",
    state: "ID",
    layouts: [{ name: "Oval", lengthMeters: mi(0.4), direction: CCW, isPrimary: true }],
  },
  {
    name: "Stateline Speedway",
    kind: TrackKind.OVAL,
    city: "Post Falls",
    state: "ID",
    layouts: [{ name: "Oval", direction: CCW, isPrimary: true }],
  },

  // -- Illinois --------------------------------------------------------------
  {
    name: "World Wide Technology Raceway",
    kind: TrackKind.OVAL,
    city: "Madison",
    state: "IL",
    notes: "Serves St. Louis but sits on the Illinois side of the river.",
    layouts: [{ name: "Oval", lengthMeters: mi(1.25), direction: CCW, isPrimary: true }],
  },
  {
    name: "Autobahn Country Club",
    kind: TrackKind.CIRCUIT,
    city: "Joliet",
    state: "IL",
    layouts: [
      { name: "Full Course", lengthMeters: mi(3.56), isPrimary: true },
      { name: "North Course", lengthMeters: mi(1.46) },
      { name: "South Course", lengthMeters: mi(2.1) },
    ],
  },
  {
    name: "Blackhawk Farms Raceway",
    kind: TrackKind.CIRCUIT,
    city: "South Beloit",
    state: "IL",
    layouts: [{ name: "Full Course", lengthMeters: mi(1.95), direction: CW, isPrimary: true }],
  },
  {
    name: "Chicagoland Speedway",
    kind: TrackKind.OVAL,
    city: "Joliet",
    state: "IL",
    notes: "No national events since 2019; the facility remains.",
    layouts: [{ name: "Tri-Oval", lengthMeters: mi(1.5), direction: CCW, isPrimary: true }],
  },

  // -- Indiana ---------------------------------------------------------------
  {
    name: "Indianapolis Motor Speedway",
    kind: TrackKind.OVAL,
    city: "Speedway",
    state: "IN",
    licenceGrade: "FIA Grade 1",
    notes: "Opened 1909. Hosts the Indianapolis 500.",
    layouts: [
      { name: "Oval", lengthMeters: mi(2.5), direction: CCW, isPrimary: true },
      { name: "Grand Prix Circuit", lengthMeters: mi(2.439), direction: CW },
    ],
  },
  {
    name: "Putnam Park Road Course",
    kind: TrackKind.CIRCUIT,
    city: "Mount Meridian",
    state: "IN",
    layouts: [{ name: "Full Course", lengthMeters: mi(1.78), direction: CW, isPrimary: true }],
  },
  {
    name: "Lucas Oil Indianapolis Raceway Park",
    kind: TrackKind.OVAL,
    city: "Brownsburg",
    state: "IN",
    layouts: [{ name: "Oval", lengthMeters: mi(0.686), direction: CCW, isPrimary: true }],
  },
  {
    name: "Winchester Speedway",
    kind: TrackKind.OVAL,
    city: "Winchester",
    state: "IN",
    notes: "One of the most steeply banked half-miles in the country, at 37 degrees.",
    layouts: [{ name: "Oval", lengthMeters: mi(0.5), direction: CCW, isPrimary: true }],
  },

  // -- Iowa ------------------------------------------------------------------
  {
    name: "Iowa Speedway",
    kind: TrackKind.OVAL,
    city: "Newton",
    state: "IA",
    layouts: [{ name: "Oval", lengthMeters: mi(0.875), direction: CCW, isPrimary: true }],
  },
  {
    name: "Knoxville Raceway",
    kind: TrackKind.OVAL,
    city: "Knoxville",
    state: "IA",
    notes: "Dirt oval; home of the Knoxville Nationals.",
    layouts: [{ name: "Oval", lengthMeters: mi(0.5), direction: CCW, isPrimary: true }],
  },
  {
    name: "Hawkeye Downs Speedway",
    kind: TrackKind.OVAL,
    city: "Cedar Rapids",
    state: "IA",
    layouts: [{ name: "Oval", lengthMeters: mi(0.5), direction: CCW, isPrimary: true }],
  },

  // -- Kansas ----------------------------------------------------------------
  {
    name: "Kansas Speedway",
    kind: TrackKind.OVAL,
    city: "Kansas City",
    state: "KS",
    notes: "Variable banking, 17 to 20 degrees.",
    layouts: [{ name: "Tri-Oval", lengthMeters: mi(1.5), direction: CCW, isPrimary: true }],
  },
  {
    name: "Heartland Motorsports Park",
    kind: TrackKind.CIRCUIT,
    city: "Topeka",
    state: "KS",
    notes: "Operations ceased in 2024; the facility's future is unresolved.",
    layouts: [{ name: "Grand Prix Course", lengthMeters: mi(2.5), isPrimary: true }],
  },
  {
    name: "Lakeside Speedway",
    kind: TrackKind.OVAL,
    city: "Kansas City",
    state: "KS",
    notes: "Dirt oval.",
    layouts: [{ name: "Oval", lengthMeters: mi(0.5), direction: CCW, isPrimary: true }],
  },

  // -- Kentucky --------------------------------------------------------------
  {
    name: "Kentucky Speedway",
    kind: TrackKind.OVAL,
    city: "Sparta",
    state: "KY",
    notes: "No national events since 2020.",
    layouts: [{ name: "Tri-Oval", lengthMeters: mi(1.5), direction: CCW, isPrimary: true }],
  },
  {
    name: "NCM Motorsports Park",
    kind: TrackKind.CIRCUIT,
    city: "Bowling Green",
    state: "KY",
    notes: "Across from the National Corvette Museum.",
    layouts: [{ name: "Full Course", lengthMeters: mi(3.15), isPrimary: true }],
  },
  {
    name: "Florence Speedway",
    kind: TrackKind.OVAL,
    city: "Union",
    state: "KY",
    notes: "Dirt oval.",
    layouts: [{ name: "Oval", lengthMeters: mi(0.5), direction: CCW, isPrimary: true }],
  },

  // -- Louisiana -------------------------------------------------------------
  {
    name: "NOLA Motorsports Park",
    kind: TrackKind.CIRCUIT,
    city: "Avondale",
    state: "LA",
    layouts: [{ name: "Full Course", lengthMeters: mi(2.75), isPrimary: true }],
  },
  {
    name: "No Problem Raceway Park",
    kind: TrackKind.CIRCUIT,
    city: "Belle Rose",
    state: "LA",
    layouts: [{ name: "Road Course", lengthMeters: mi(1.8), isPrimary: true }],
  },

  // -- Maine -----------------------------------------------------------------
  {
    name: "Oxford Plains Speedway",
    kind: TrackKind.OVAL,
    city: "Oxford",
    state: "ME",
    notes: "Home of the Oxford 250.",
    layouts: [{ name: "Oval", lengthMeters: mi(0.375), direction: CCW, isPrimary: true }],
  },
  {
    name: "Wiscasset Speedway",
    kind: TrackKind.OVAL,
    city: "Wiscasset",
    state: "ME",
    layouts: [{ name: "Oval", lengthMeters: mi(0.333), direction: CCW, isPrimary: true }],
  },

  // -- Maryland --------------------------------------------------------------
  {
    name: "Hagerstown Speedway",
    kind: TrackKind.OVAL,
    city: "Hagerstown",
    state: "MD",
    notes: "Dirt oval.",
    layouts: [{ name: "Oval", lengthMeters: mi(0.5), direction: CCW, isPrimary: true }],
  },
  {
    name: "Potomac Speedway",
    kind: TrackKind.OVAL,
    city: "Budds Creek",
    state: "MD",
    notes: "Dirt oval.",
    layouts: [{ name: "Oval", lengthMeters: mi(0.25), direction: CCW, isPrimary: true }],
  },

  // -- Massachusetts ---------------------------------------------------------
  {
    name: "Palmer Motorsports Park",
    kind: TrackKind.CIRCUIT,
    city: "Palmer",
    state: "MA",
    notes:
      "Whiskey Hill Raceway: 14 turns up and down roughly 190 feet of Whiskey Hill. Run in both directions.",
    layouts: [
      { name: "Whiskey Hill Raceway", lengthMeters: mi(2.3), direction: CW, isPrimary: true },
      { name: "Whiskey Hill Raceway (Reverse)", lengthMeters: mi(2.3), direction: CCW },
    ],
  },
  {
    name: "Seekonk Speedway",
    kind: TrackKind.OVAL,
    city: "Seekonk",
    state: "MA",
    notes: "Opened 1946.",
    layouts: [{ name: "Oval", lengthMeters: mi(0.333), direction: CCW, isPrimary: true }],
  },

  // -- Michigan --------------------------------------------------------------
  {
    name: "Michigan International Speedway",
    kind: TrackKind.OVAL,
    city: "Brooklyn",
    state: "MI",
    notes: "18-degree banking and wide sightlines; among the fastest ovals in NASCAR.",
    layouts: [{ name: "D-Oval", lengthMeters: mi(2.0), direction: CCW, isPrimary: true }],
  },
  {
    name: "GingerMan Raceway",
    kind: TrackKind.CIRCUIT,
    city: "South Haven",
    state: "MI",
    layouts: [{ name: "Full Course", lengthMeters: mi(2.14), direction: CW, isPrimary: true }],
  },
  {
    name: "Grattan Raceway",
    kind: TrackKind.CIRCUIT,
    city: "Belding",
    state: "MI",
    layouts: [{ name: "Full Course", lengthMeters: mi(2.0), isPrimary: true }],
  },
  {
    name: "Waterford Hills Road Racing",
    kind: TrackKind.CIRCUIT,
    city: "Clarkston",
    state: "MI",
    layouts: [{ name: "Full Course", lengthMeters: mi(1.42), isPrimary: true }],
  },
  {
    name: "M1 Concourse",
    kind: TrackKind.CIRCUIT,
    city: "Pontiac",
    state: "MI",
    layouts: [{ name: "Champion Motor Speedway", lengthMeters: mi(1.5), isPrimary: true }],
  },

  // -- Minnesota -------------------------------------------------------------
  {
    name: "Brainerd International Raceway",
    kind: TrackKind.CIRCUIT,
    city: "Brainerd",
    state: "MN",
    layouts: [
      { name: "Donnybrooke", lengthMeters: mi(3.1), isPrimary: true },
      { name: "Competition Course", lengthMeters: mi(2.5) },
    ],
  },
  {
    name: "Elko Speedway",
    kind: TrackKind.OVAL,
    city: "Elko New Market",
    state: "MN",
    layouts: [{ name: "Oval", lengthMeters: mi(0.375), direction: CCW, isPrimary: true }],
  },

  // -- Mississippi -----------------------------------------------------------
  {
    name: "Jackson Motor Speedway",
    kind: TrackKind.OVAL,
    city: "Byram",
    state: "MS",
    notes: "Dirt oval.",
    layouts: [{ name: "Oval", lengthMeters: mi(0.25), direction: CCW, isPrimary: true }],
  },
  {
    name: "Columbus Speedway",
    kind: TrackKind.OVAL,
    city: "Columbus",
    state: "MS",
    notes: "Dirt oval.",
    layouts: [{ name: "Oval", direction: CCW, isPrimary: true }],
  },

  // -- Missouri --------------------------------------------------------------
  {
    name: "Lucas Oil Speedway",
    kind: TrackKind.OVAL,
    city: "Wheatland",
    state: "MO",
    notes: "Dirt oval.",
    layouts: [{ name: "Oval", lengthMeters: mi(0.375), direction: CCW, isPrimary: true }],
  },
  {
    name: "Missouri State Fair Speedway",
    kind: TrackKind.OVAL,
    city: "Sedalia",
    state: "MO",
    notes: "Dirt oval.",
    layouts: [{ name: "Oval", lengthMeters: mi(0.5), direction: CCW, isPrimary: true }],
  },

  // -- Montana ---------------------------------------------------------------
  {
    name: "Montana Raceway Park",
    kind: TrackKind.OVAL,
    city: "Kalispell",
    state: "MT",
    layouts: [{ name: "Oval", lengthMeters: mi(0.25), direction: CCW, isPrimary: true }],
  },
  {
    name: "Electric City Speedway",
    kind: TrackKind.OVAL,
    city: "Great Falls",
    state: "MT",
    notes: "Dirt oval.",
    layouts: [{ name: "Oval", direction: CCW, isPrimary: true }],
  },

  // -- Nebraska --------------------------------------------------------------
  {
    name: "I-80 Speedway",
    kind: TrackKind.OVAL,
    city: "Greenwood",
    state: "NE",
    notes: "Dirt oval.",
    layouts: [{ name: "Oval", lengthMeters: mi(0.375), direction: CCW, isPrimary: true }],
  },
  {
    name: "Eagle Raceway",
    kind: TrackKind.OVAL,
    city: "Eagle",
    state: "NE",
    notes: "Dirt oval.",
    layouts: [{ name: "Oval", lengthMeters: mi(0.333), direction: CCW, isPrimary: true }],
  },

  // -- Nevada ----------------------------------------------------------------
  {
    name: "Las Vegas Motor Speedway",
    kind: TrackKind.OVAL,
    city: "Las Vegas",
    state: "NV",
    layouts: [
      { name: "Superspeedway", lengthMeters: mi(1.5), direction: CCW, isPrimary: true },
      { name: "Outside Road Course", lengthMeters: mi(2.4) },
    ],
  },
  {
    name: "Spring Mountain Motor Resort",
    kind: TrackKind.CIRCUIT,
    city: "Pahrump",
    state: "NV",
    notes: "Multiple configurations combining to over six miles.",
    layouts: [{ name: "Full Course", lengthMeters: mi(6.1), isPrimary: true }],
  },
  {
    name: "Reno-Fernley Raceway",
    kind: TrackKind.CIRCUIT,
    city: "Fernley",
    state: "NV",
    layouts: [{ name: "Full Course", lengthMeters: mi(5.4), isPrimary: true }],
  },

  // -- New Hampshire ---------------------------------------------------------
  {
    name: "New Hampshire Motor Speedway",
    kind: TrackKind.OVAL,
    city: "Loudon",
    state: "NH",
    layouts: [
      { name: "Oval", lengthMeters: mi(1.058), direction: CCW, isPrimary: true },
      { name: "Road Course", lengthMeters: mi(1.6) },
    ],
  },
  {
    name: "Club Motorsports",
    kind: TrackKind.CIRCUIT,
    city: "Tamworth",
    state: "NH",
    notes: "Over 250 feet of elevation change.",
    layouts: [{ name: "Full Course", lengthMeters: mi(2.5), isPrimary: true }],
  },
  {
    name: "Lee USA Speedway",
    kind: TrackKind.OVAL,
    city: "Lee",
    state: "NH",
    layouts: [{ name: "Oval", lengthMeters: mi(0.375), direction: CCW, isPrimary: true }],
  },
  {
    name: "Monadnock Speedway",
    kind: TrackKind.OVAL,
    city: "Winchester",
    state: "NH",
    layouts: [{ name: "Oval", lengthMeters: mi(0.25), direction: CCW, isPrimary: true }],
  },

  // -- New Jersey ------------------------------------------------------------
  {
    name: "New Jersey Motorsports Park",
    kind: TrackKind.CIRCUIT,
    city: "Millville",
    state: "NJ",
    layouts: [
      { name: "Thunderbolt", lengthMeters: mi(2.25), isPrimary: true },
      { name: "Lightning", lengthMeters: mi(1.9) },
    ],
  },
  {
    name: "Wall Stadium Speedway",
    kind: TrackKind.OVAL,
    city: "Wall Township",
    state: "NJ",
    layouts: [{ name: "Oval", lengthMeters: mi(0.333), direction: CCW, isPrimary: true }],
  },

  // -- New Mexico ------------------------------------------------------------
  {
    name: "Sandia Speedway",
    kind: TrackKind.CIRCUIT,
    city: "Albuquerque",
    state: "NM",
    layouts: [
      { name: "Road Course", lengthMeters: mi(1.7), isPrimary: true },
      { name: "Short Course", lengthMeters: mi(1.1) },
    ],
  },
  {
    name: "Southern New Mexico Speedway",
    kind: TrackKind.OVAL,
    city: "Las Cruces",
    state: "NM",
    notes: "Dirt oval.",
    layouts: [{ name: "Oval", lengthMeters: mi(0.375), direction: CCW, isPrimary: true }],
  },

  // -- New York --------------------------------------------------------------
  {
    name: "Watkins Glen International",
    kind: TrackKind.CIRCUIT,
    city: "Watkins Glen",
    state: "NY",
    licenceGrade: "FIA Grade 2",
    notes: "Hosted the United States Grand Prix from 1961 to 1980.",
    layouts: [
      { name: "Long Course", lengthMeters: mi(3.4), direction: CW, isPrimary: true },
      { name: "Short Course", lengthMeters: mi(2.45), direction: CW },
    ],
  },
  {
    name: "Monticello Motor Club",
    kind: TrackKind.CIRCUIT,
    city: "Monticello",
    state: "NY",
    layouts: [{ name: "Full Course", lengthMeters: mi(4.1), isPrimary: true }],
  },
  {
    name: "Oswego Speedway",
    kind: TrackKind.OVAL,
    city: "Oswego",
    state: "NY",
    notes: "Asphalt oval; home of the Supermodified Classic.",
    layouts: [{ name: "Oval", lengthMeters: mi(0.625), direction: CCW, isPrimary: true }],
  },
  {
    name: "Riverhead Raceway",
    kind: TrackKind.OVAL,
    city: "Riverhead",
    state: "NY",
    layouts: [{ name: "Oval", lengthMeters: mi(0.25), direction: CCW, isPrimary: true }],
  },

  // -- North Carolina --------------------------------------------------------
  {
    name: "Charlotte Motor Speedway",
    kind: TrackKind.OVAL,
    city: "Concord",
    state: "NC",
    layouts: [
      { name: "Quad-Oval", lengthMeters: mi(1.5), direction: CCW, isPrimary: true },
      { name: "Roval", lengthMeters: mi(2.28) },
    ],
  },
  {
    name: "North Wilkesboro Speedway",
    kind: TrackKind.OVAL,
    city: "North Wilkesboro",
    state: "NC",
    notes: "Reopened in 2023 after 27 years dormant. The frontstretch and backstretch have different gradients.",
    layouts: [{ name: "Oval", lengthMeters: mi(0.625), direction: CCW, isPrimary: true }],
  },
  {
    name: "Rockingham Speedway",
    kind: TrackKind.OVAL,
    city: "Rockingham",
    state: "NC",
    layouts: [{ name: "Oval", lengthMeters: mi(1.017), direction: CCW, isPrimary: true }],
  },
  {
    name: "Hickory Motor Speedway",
    kind: TrackKind.OVAL,
    city: "Newton",
    state: "NC",
    notes: "Opened 1951; long known as a proving ground for NASCAR drivers.",
    layouts: [{ name: "Oval", lengthMeters: mi(0.363), direction: CCW, isPrimary: true }],
  },

  // -- North Dakota ----------------------------------------------------------
  {
    name: "Dacotah Speedway",
    kind: TrackKind.OVAL,
    city: "Mandan",
    state: "ND",
    notes: "Dirt oval.",
    layouts: [{ name: "Oval", lengthMeters: mi(0.25), direction: CCW, isPrimary: true }],
  },
  {
    name: "Red River Valley Speedway",
    kind: TrackKind.OVAL,
    city: "West Fargo",
    state: "ND",
    notes: "Dirt oval.",
    layouts: [{ name: "Oval", lengthMeters: mi(0.25), direction: CCW, isPrimary: true }],
  },

  // -- Ohio ------------------------------------------------------------------
  {
    name: "Mid-Ohio Sports Car Course",
    kind: TrackKind.CIRCUIT,
    city: "Lexington",
    state: "OH",
    layouts: [
      { name: "Full Course", lengthMeters: mi(2.4), direction: CW, isPrimary: true },
      { name: "Club Course", lengthMeters: mi(2.258), direction: CW },
    ],
  },
  {
    name: "Nelson Ledges Road Course",
    kind: TrackKind.CIRCUIT,
    city: "Garrettsville",
    state: "OH",
    layouts: [{ name: "Full Course", lengthMeters: mi(2.0), isPrimary: true }],
  },
  {
    name: "Eldora Speedway",
    kind: TrackKind.OVAL,
    city: "Rossburg",
    state: "OH",
    notes: "Dirt oval with 24-degree banking; home of the Kings Royal and the World 100.",
    layouts: [{ name: "Oval", lengthMeters: mi(0.5), direction: CCW, isPrimary: true }],
  },
  {
    name: "Columbus Motor Speedway",
    kind: TrackKind.OVAL,
    city: "Columbus",
    state: "OH",
    layouts: [{ name: "Oval", lengthMeters: mi(0.333), direction: CCW, isPrimary: true }],
  },

  // -- Oklahoma --------------------------------------------------------------
  {
    name: "Hallett Motor Racing Circuit",
    kind: TrackKind.CIRCUIT,
    city: "Jennings",
    state: "OK",
    notes: "Over 80 feet of elevation change; run in both directions.",
    layouts: [
      { name: "Clockwise", lengthMeters: mi(1.8), direction: CW, isPrimary: true },
      { name: "Anticlockwise", lengthMeters: mi(1.8), direction: CCW },
    ],
  },
  {
    name: "Tulsa Speedway",
    kind: TrackKind.OVAL,
    city: "Tulsa",
    state: "OK",
    notes: "Dirt oval.",
    layouts: [{ name: "Oval", lengthMeters: mi(0.375), direction: CCW, isPrimary: true }],
  },

  // -- Oregon ----------------------------------------------------------------
  {
    name: "Portland International Raceway",
    kind: TrackKind.CIRCUIT,
    city: "Portland",
    state: "OR",
    layouts: [
      { name: "Full Course", lengthMeters: mi(1.967), direction: CW, isPrimary: true },
      { name: "Short Course", lengthMeters: mi(1.915), direction: CW },
    ],
  },
  {
    name: "Oregon Raceway Park",
    kind: TrackKind.CIRCUIT,
    city: "Grass Valley",
    state: "OR",
    layouts: [{ name: "Full Course", lengthMeters: mi(2.3), isPrimary: true }],
  },

  // -- Pennsylvania ----------------------------------------------------------
  {
    name: "Pocono Raceway",
    kind: TrackKind.OVAL,
    city: "Long Pond",
    state: "PA",
    notes: "Three corners, each with different banking — the Tricky Triangle.",
    layouts: [{ name: "Tri-Oval", lengthMeters: mi(2.5), direction: CCW, isPrimary: true }],
  },
  {
    name: "Pittsburgh International Race Complex",
    kind: TrackKind.CIRCUIT,
    city: "Wampum",
    state: "PA",
    layouts: [
      { name: "North Course", lengthMeters: mi(2.8), isPrimary: true },
      { name: "South Course", lengthMeters: mi(1.6) },
    ],
  },
  {
    name: "Williams Grove Speedway",
    kind: TrackKind.OVAL,
    city: "Mechanicsburg",
    state: "PA",
    notes: "Dirt oval; a cornerstone of Pennsylvania sprint car racing.",
    layouts: [{ name: "Oval", lengthMeters: mi(0.5), direction: CCW, isPrimary: true }],
  },
  {
    name: "Jennerstown Speedway Complex",
    kind: TrackKind.OVAL,
    city: "Jennerstown",
    state: "PA",
    layouts: [{ name: "Oval", lengthMeters: mi(0.522), direction: CCW, isPrimary: true }],
  },

  // -- South Carolina --------------------------------------------------------
  {
    name: "Darlington Raceway",
    kind: TrackKind.OVAL,
    city: "Darlington",
    state: "SC",
    notes: "Egg-shaped, with each end a different radius — the track too tough to tame.",
    layouts: [{ name: "Oval", lengthMeters: mi(1.366), direction: CCW, isPrimary: true }],
  },
  {
    name: "Carolina Motorsports Park",
    kind: TrackKind.CIRCUIT,
    city: "Kershaw",
    state: "SC",
    layouts: [{ name: "Full Course", lengthMeters: mi(2.27), isPrimary: true }],
  },
  {
    name: "Greenville-Pickens Speedway",
    kind: TrackKind.OVAL,
    city: "Easley",
    state: "SC",
    layouts: [{ name: "Oval", lengthMeters: mi(0.5), direction: CCW, isPrimary: true }],
  },

  // -- South Dakota ----------------------------------------------------------
  {
    name: "Huset's Speedway",
    kind: TrackKind.OVAL,
    city: "Brandon",
    state: "SD",
    notes: "Dirt oval.",
    layouts: [{ name: "Oval", lengthMeters: mi(0.25), direction: CCW, isPrimary: true }],
  },
  {
    name: "Black Hills Speedway",
    kind: TrackKind.OVAL,
    city: "Rapid City",
    state: "SD",
    notes: "Dirt oval.",
    layouts: [{ name: "Oval", direction: CCW, isPrimary: true }],
  },

  // -- Tennessee -------------------------------------------------------------
  {
    name: "Bristol Motor Speedway",
    kind: TrackKind.OVAL,
    city: "Bristol",
    state: "TN",
    notes: "Concrete, with banking between 24 and 30 degrees. Converted to dirt for selected events.",
    layouts: [{ name: "Oval", lengthMeters: mi(0.533), direction: CCW, isPrimary: true }],
  },
  {
    name: "Nashville Superspeedway",
    kind: TrackKind.OVAL,
    city: "Lebanon",
    state: "TN",
    notes: "Concrete surface.",
    layouts: [{ name: "Oval", lengthMeters: mi(1.33), direction: CCW, isPrimary: true }],
  },
  {
    name: "Nashville Fairgrounds Speedway",
    kind: TrackKind.OVAL,
    city: "Nashville",
    state: "TN",
    notes: "Opened 1904; one of the oldest operating speedways in the country.",
    layouts: [{ name: "Oval", lengthMeters: mi(0.596), direction: CCW, isPrimary: true }],
  },
  {
    name: "Memphis International Raceway",
    kind: TrackKind.OVAL,
    city: "Millington",
    state: "TN",
    layouts: [{ name: "Oval", lengthMeters: mi(0.75), direction: CCW, isPrimary: true }],
  },

  // -- Texas -----------------------------------------------------------------
  {
    name: "Circuit of the Americas",
    kind: TrackKind.CIRCUIT,
    city: "Austin",
    state: "TX",
    licenceGrade: "FIA Grade 1",
    notes: "Hosts the United States Grand Prix. Turn 1 climbs roughly 133 feet.",
    layouts: [{ name: "Grand Prix", lengthMeters: mi(3.426), direction: CCW, isPrimary: true }],
  },
  {
    name: "Texas Motor Speedway",
    kind: TrackKind.OVAL,
    city: "Fort Worth",
    state: "TX",
    layouts: [{ name: "Quad-Oval", lengthMeters: mi(1.5), direction: CCW, isPrimary: true }],
  },
  {
    name: "MotorSport Ranch Cresson",
    kind: TrackKind.CIRCUIT,
    city: "Cresson",
    state: "TX",
    layouts: [
      { name: "Combined Course", lengthMeters: mi(3.1), isPrimary: true },
      { name: "East Course", lengthMeters: mi(1.7) },
      { name: "West Course", lengthMeters: mi(1.3) },
    ],
  },
  {
    name: "Eagles Canyon Raceway",
    kind: TrackKind.CIRCUIT,
    city: "Decatur",
    state: "TX",
    notes: "Over 200 feet of elevation change.",
    layouts: [
      { name: "Full Course", lengthMeters: mi(2.7), direction: CCW, isPrimary: true },
      { name: "East Course", lengthMeters: mi(1.65), direction: CCW },
    ],
  },
  {
    name: "MSR Houston",
    kind: TrackKind.CIRCUIT,
    city: "Angleton",
    state: "TX",
    layouts: [{ name: "Full Course", lengthMeters: mi(2.38), isPrimary: true }],
  },

  // -- Utah ------------------------------------------------------------------
  {
    name: "Utah Motorsports Campus",
    kind: TrackKind.CIRCUIT,
    city: "Tooele",
    state: "UT",
    notes: "Splits into several independently usable configurations.",
    layouts: [
      { name: "Full Course", lengthMeters: mi(4.5), isPrimary: true },
      { name: "Outer Course", lengthMeters: mi(3.05) },
      { name: "East Course", lengthMeters: mi(2.2) },
      { name: "West Course", lengthMeters: mi(1.5) },
    ],
  },
  {
    name: "Desert Thunder Raceway",
    kind: TrackKind.OVAL,
    city: "Price",
    state: "UT",
    notes: "Dirt oval.",
    layouts: [{ name: "Oval", lengthMeters: mi(0.375), direction: CCW, isPrimary: true }],
  },

  // -- Vermont ---------------------------------------------------------------
  {
    name: "Thunder Road International Speedbowl",
    kind: TrackKind.OVAL,
    city: "Barre",
    state: "VT",
    layouts: [{ name: "Oval", lengthMeters: mi(0.25), direction: CCW, isPrimary: true }],
  },
  {
    name: "Devil's Bowl Speedway",
    kind: TrackKind.OVAL,
    city: "West Haven",
    state: "VT",
    notes: "Dirt oval.",
    layouts: [{ name: "Oval", lengthMeters: mi(0.5), direction: CCW, isPrimary: true }],
  },

  // -- Virginia --------------------------------------------------------------
  {
    name: "Virginia International Raceway",
    kind: TrackKind.CIRCUIT,
    city: "Alton",
    state: "VA",
    licenceGrade: "FIA Grade 2",
    notes: "Several configurations run independently or combined.",
    layouts: [
      { name: "Full Course", lengthMeters: mi(3.27), direction: CW, isPrimary: true },
      { name: "Grand Course", lengthMeters: mi(4.2), direction: CW },
      { name: "North Course", lengthMeters: mi(2.25), direction: CW },
      { name: "Patriot Course", lengthMeters: mi(1.1), direction: CW },
    ],
  },
  {
    name: "Martinsville Speedway",
    kind: TrackKind.OVAL,
    city: "Ridgeway",
    state: "VA",
    notes: "Paperclip shape with concrete corners; the shortest track in the NASCAR Cup Series.",
    layouts: [{ name: "Oval", lengthMeters: mi(0.526), direction: CCW, isPrimary: true }],
  },
  {
    name: "Richmond Raceway",
    kind: TrackKind.OVAL,
    city: "Richmond",
    state: "VA",
    layouts: [{ name: "D-Oval", lengthMeters: mi(0.75), direction: CCW, isPrimary: true }],
  },
  {
    name: "Dominion Raceway",
    kind: TrackKind.CIRCUIT,
    city: "Thornburg",
    state: "VA",
    layouts: [
      { name: "Road Course", lengthMeters: mi(2.0), isPrimary: true },
      { name: "Oval", lengthMeters: mi(0.4), direction: CCW },
    ],
  },

  // -- Washington ------------------------------------------------------------
  {
    name: "Pacific Raceways",
    kind: TrackKind.CIRCUIT,
    city: "Kent",
    state: "WA",
    layouts: [{ name: "Full Course", lengthMeters: mi(2.25), direction: CW, isPrimary: true }],
  },
  {
    name: "The Ridge Motorsports Park",
    kind: TrackKind.CIRCUIT,
    city: "Shelton",
    state: "WA",
    layouts: [{ name: "Full Course", lengthMeters: mi(2.47), isPrimary: true }],
  },
  {
    name: "Evergreen Speedway",
    kind: TrackKind.OVAL,
    city: "Monroe",
    state: "WA",
    layouts: [
      { name: "Oval", lengthMeters: mi(0.646), direction: CCW, isPrimary: true },
      { name: "Short Oval", lengthMeters: mi(0.375), direction: CCW },
    ],
  },

  // -- West Virginia ---------------------------------------------------------
  {
    name: "Summit Point Motorsports Park",
    kind: TrackKind.CIRCUIT,
    city: "Summit Point",
    state: "WV",
    notes: "Three independent circuits on one site.",
    layouts: [
      { name: "Main Circuit", lengthMeters: mi(2.0), direction: CW, isPrimary: true },
      { name: "Shenandoah Circuit", lengthMeters: mi(2.2) },
      { name: "Jefferson Circuit", lengthMeters: mi(1.1) },
    ],
  },
  {
    name: "Ona Speedway",
    kind: TrackKind.OVAL,
    city: "Milton",
    state: "WV",
    layouts: [{ name: "Oval", lengthMeters: mi(0.375), direction: CCW, isPrimary: true }],
  },

  // -- Wisconsin -------------------------------------------------------------
  {
    name: "Road America",
    kind: TrackKind.CIRCUIT,
    city: "Elkhart Lake",
    state: "WI",
    licenceGrade: "FIA Grade 2",
    notes: "Four miles with no chicanes on the original layout; among the fastest road courses in North America.",
    layouts: [{ name: "Full Course", lengthMeters: mi(4.048), direction: CW, isPrimary: true }],
  },
  {
    name: "Milwaukee Mile",
    kind: TrackKind.OVAL,
    city: "West Allis",
    state: "WI",
    notes: "Racing since 1903; the oldest continuously operating motor speedway in the world.",
    layouts: [{ name: "Oval", lengthMeters: mi(1.0), direction: CCW, isPrimary: true }],
  },
  {
    name: "Slinger Speedway",
    kind: TrackKind.OVAL,
    city: "Slinger",
    state: "WI",
    notes: "Steeply banked quarter-mile.",
    layouts: [{ name: "Oval", lengthMeters: mi(0.25), direction: CCW, isPrimary: true }],
  },
  {
    name: "Madison International Speedway",
    kind: TrackKind.OVAL,
    city: "Oregon",
    state: "WI",
    layouts: [{ name: "Oval", lengthMeters: mi(0.5), direction: CCW, isPrimary: true }],
  },

  // -- Wyoming ---------------------------------------------------------------
  {
    name: "Sweetwater Speedway",
    kind: TrackKind.OVAL,
    city: "Rock Springs",
    state: "WY",
    notes: "Dirt oval.",
    layouts: [{ name: "Oval", lengthMeters: mi(0.375), direction: CCW, isPrimary: true }],
  },
  {
    name: "Big Country Speedway",
    kind: TrackKind.OVAL,
    city: "Cheyenne",
    state: "WY",
    layouts: [{ name: "Oval", lengthMeters: mi(0.25), direction: CCW, isPrimary: true }],
  },
];

/**
 * States with no entry.
 *
 * Recorded explicitly rather than left as a silent gap, so it is obvious this
 * is a deliberate omission rather than something forgotten. Rhode Island has
 * no active permanent road course or paved oval; padding the list with a
 * karting circuit or a long-closed venue would make the directory less
 * trustworthy, not more complete.
 */
export const STATES_WITHOUT_TRACKS = ["RI"] as const;
