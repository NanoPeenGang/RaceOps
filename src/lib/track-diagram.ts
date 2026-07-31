import { LayoutShape, TrackDirection } from "@prisma/client";

/**
 * Drawing a layout when nobody has uploaded a map of it.
 *
 * ## What this will and will not draw
 *
 * An oval's plan shape follows from a handful of facts a circuit publishes:
 * it is a tri-oval, the turns are banked 33 degrees, it runs anticlockwise.
 * Turning those into a diagram invents nothing — it is the same information
 * the sentence carries, arranged so you can take it in at a glance, and a
 * paperclip is instantly distinguishable from a superspeedway.
 *
 * A road course is not like that. Its outline is survey data. There is no
 * function from "4.048 km, 14 turns, clockwise" to the shape of Road America,
 * and a plausible-looking squiggle under that name would be a fabricated map
 * in a tool people use to plan race weekends. So road courses get a real
 * uploaded diagram or an honest blank — never a generated one.
 *
 * Everything here is therefore explicitly a **schematic**: correct in shape
 * and direction of travel, deliberately not to scale. The renderer labels it
 * as such, because a diagram that looks surveyed will be read as surveyed.
 */

export interface DiagramSpec {
  /** SVG path data for the outline, in the `viewBox` coordinate space. */
  path: string;
  viewBox: string;
  /** Where to put the direction arrow, and which way it points. */
  arrow: { x: number; y: number; pointsRight: boolean };
  /** Screen-reader description; also the caption when there is room. */
  label: string;
}

const VIEW_BOX = "0 0 200 132";

/*
 * Each shape is drawn once at a canonical size rather than scaled by length.
 * Scaling would imply a survey we do not have — and at directory-thumbnail
 * size a 0.4-mile bullring and a 2.5-mile superspeedway drawn to scale would
 * be a dot and a rectangle, which tells you less than the shape does.
 */
const SHAPE_PATHS: Record<LayoutShape, string> = {
  // Stadium: two straights, two semicircular ends.
  OVAL: "M 40 22 L 160 22 A 40 40 0 0 1 160 102 L 40 102 A 40 40 0 0 1 40 22 Z",

  // One straight bulges outward into a shallow third bend.
  TRI_OVAL:
    "M 40 22 L 160 22 A 40 40 0 0 1 160 102 L 128 102 L 100 116 L 72 102 L 40 102 A 40 40 0 0 1 40 22 Z",

  // The front straight bends twice, leaving a flat centre section.
  QUAD_OVAL:
    "M 40 22 L 160 22 A 40 40 0 0 1 160 102 L 134 102 L 116 114 L 84 114 L 66 102 L 40 102 A 40 40 0 0 1 40 22 Z",

  // Long straights into tight hairpins: narrow ends, wide body.
  PAPERCLIP:
    "M 28 37 L 172 37 A 25 25 0 0 1 172 87 L 28 87 A 25 25 0 0 1 28 37 Z",

  // One end sweeping and wide, the other tighter.
  D_SHAPE:
    "M 48 22 L 148 22 A 56 40 0 0 1 148 102 L 48 102 A 22 40 0 0 1 48 22 Z",

  // Three straights, three corners.
  TRIANGLE:
    "M 100 18 L 176 100 A 14 14 0 0 1 166 110 L 34 110 A 14 14 0 0 1 24 100 L 90 18 A 14 14 0 0 1 100 18 Z",

  // Four long straights joined by short corners.
  RECTANGLE:
    "M 36 24 L 164 24 A 14 14 0 0 1 174 34 L 174 90 A 14 14 0 0 1 164 100 L 36 100 A 14 14 0 0 1 26 90 L 26 34 A 14 14 0 0 1 36 24 Z",
};

const SHAPE_LABELS: Record<LayoutShape, string> = {
  OVAL: "oval",
  TRI_OVAL: "tri-oval",
  QUAD_OVAL: "quad-oval",
  PAPERCLIP: "paperclip oval",
  D_SHAPE: "D-shaped oval",
  TRIANGLE: "triangular oval",
  RECTANGLE: "rectangular oval",
};

/** How a shape reads in prose: "Tri-oval", for a spec list. */
export function shapeLabel(shape: LayoutShape): string {
  const label = SHAPE_LABELS[shape];
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export interface DiagrammableLayout {
  shape?: LayoutShape | null;
  direction?: TrackDirection | null;
  bankingDegrees?: number | null;
}

/**
 * A schematic for this layout, or null when its shape is not derivable.
 *
 * Null is the common answer and the right one: it means "we do not know what
 * this looks like", which the UI turns into an invitation to upload a map
 * rather than a drawing nobody should trust.
 */
export function layoutDiagram(
  layout: DiagrammableLayout,
): DiagramSpec | null {
  if (!layout.shape) return null;

  const anticlockwise = layout.direction === TrackDirection.ANTICLOCKWISE;
  const banking = layout.bankingDegrees;

  return {
    path: SHAPE_PATHS[layout.shape],
    viewBox: VIEW_BOX,
    // On the top straight, where there is always clear space. The path is
    // drawn clockwise on screen, so a clockwise layout runs left-to-right
    // there and an anticlockwise one runs the other way.
    arrow: { x: 100, y: 22, pointsRight: !anticlockwise },
    label: [
      `Schematic of a ${SHAPE_LABELS[layout.shape]}`,
      anticlockwise ? "run anticlockwise" : "run clockwise",
      banking ? `with ${banking}-degree banking` : null,
    ]
      .filter(Boolean)
      .join(", "),
  };
}

// ---------------------------------------------------------------------------
// The rest of the spec panel
// ---------------------------------------------------------------------------

/** "14 turns" / "1 turn" / null when nobody has recorded a count. */
export function formatTurns(count: number | null | undefined): string | null {
  if (count === null || count === undefined || count <= 0) return null;
  return `${count} turn${count === 1 ? "" : "s"}`;
}

/** "33° banking", the way an oval is described. */
export function formatBanking(degrees: number | null | undefined): string | null {
  if (degrees === null || degrees === undefined || degrees < 0) return null;
  return degrees === 0 ? "Flat" : `${degrees}° banking`;
}

/** Metres of elevation change over a lap, in the units the venue publishes. */
export function formatElevation(meters: number | null | undefined): string | null {
  if (meters === null || meters === undefined || meters <= 0) return null;
  return `${meters} m elevation change`;
}

export interface Coordinates {
  latitude?: number | null;
  longitude?: number | null;
}

/** True when both halves of a coordinate are present and in range. */
export function hasCoordinates(place: Coordinates): boolean {
  const { latitude: lat, longitude: lng } = place;
  if (lat === null || lat === undefined || lng === null || lng === undefined) {
    return false;
  }
  if (Number.isNaN(lat) || Number.isNaN(lng)) return false;
  // 0,0 is in the Gulf of Guinea. It is almost always an unset field that got
  // saved as a number, and pinning a circuit there is worse than no pin.
  if (lat === 0 && lng === 0) return false;
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

/** Six decimal places is about 10 cm — past that is noise. */
export function formatCoordinates(place: Coordinates): string | null {
  if (!hasCoordinates(place)) return null;
  return `${place.latitude!.toFixed(5)}, ${place.longitude!.toFixed(5)}`;
}

/**
 * A maps link for a set of coordinates.
 *
 * A `geo:` URI would be the correct thing and opens the phone's own map app,
 * but desktop browsers do nothing with it, and the person most likely to click
 * this is planning a tow at a laptop. The universal Google Maps query URL
 * works on both, and every mobile OS deep-links it into a map app anyway.
 */
export function mapUrl(place: Coordinates): string | null {
  if (!hasCoordinates(place)) return null;
  return `https://www.google.com/maps/search/?api=1&query=${place.latitude},${place.longitude}`;
}

/**
 * A maps link for a venue, by coordinates where we have them and by name
 * otherwise.
 *
 * The fallback matters more than it looks. Coordinates are the one field on a
 * circuit that is dangerous to guess — a pin ten miles out sends a transporter
 * to a field — so most tracks here have none. But "Road America, Elkhart Lake,
 * WI" put through a map search lands in the right car park every time and
 * asserts nothing we do not know.
 */
export function venueMapUrl(
  place: Coordinates & {
    name: string;
    city?: string | null;
    region?: string | null;
    country?: string | null;
  },
): string {
  const pin = mapUrl(place);
  if (pin) return pin;
  const query = [place.name, place.city, place.region, place.country]
    .filter(Boolean)
    .join(", ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}
