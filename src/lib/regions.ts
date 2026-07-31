/**
 * Turning stored codes into words people read.
 *
 * Tracks store a two-letter country and a free-text region, because that is
 * what actually fits the world: "CA" for California in the US, "Bayern" in
 * Germany, and a blank for a venue whose region nobody has filled in. The
 * display layer expands what it recognises and passes through what it does
 * not — so a filter reading "New Jersey" and one reading "Ontario" both work,
 * and neither needs the other to be enumerated first.
 */

/** US states and DC, keyed by the postal abbreviation stored on a track. */
export const US_STATE_NAMES: Record<string, string> = {
  AL: "Alabama",
  AK: "Alaska",
  AZ: "Arizona",
  AR: "Arkansas",
  CA: "California",
  CO: "Colorado",
  CT: "Connecticut",
  DE: "Delaware",
  DC: "District of Columbia",
  FL: "Florida",
  GA: "Georgia",
  HI: "Hawaii",
  ID: "Idaho",
  IL: "Illinois",
  IN: "Indiana",
  IA: "Iowa",
  KS: "Kansas",
  KY: "Kentucky",
  LA: "Louisiana",
  ME: "Maine",
  MD: "Maryland",
  MA: "Massachusetts",
  MI: "Michigan",
  MN: "Minnesota",
  MS: "Mississippi",
  MO: "Missouri",
  MT: "Montana",
  NE: "Nebraska",
  NV: "Nevada",
  NH: "New Hampshire",
  NJ: "New Jersey",
  NM: "New Mexico",
  NY: "New York",
  NC: "North Carolina",
  ND: "North Dakota",
  OH: "Ohio",
  OK: "Oklahoma",
  OR: "Oregon",
  PA: "Pennsylvania",
  RI: "Rhode Island",
  SC: "South Carolina",
  SD: "South Dakota",
  TN: "Tennessee",
  TX: "Texas",
  UT: "Utah",
  VT: "Vermont",
  VA: "Virginia",
  WA: "Washington",
  WV: "West Virginia",
  WI: "Wisconsin",
  WY: "Wyoming",
};

/**
 * Every region code the app can expand.
 *
 * US states for now, since that is where the shipped track directory is.
 * Anything absent renders as stored, which is the point — a Belgian club
 * typing "Liège" gets "Liège" and nobody has to add it here first.
 */
export const REGION_LABELS: Record<string, string> = { ...US_STATE_NAMES };

/**
 * Country name from an ISO 3166-1 alpha-2 code.
 *
 * Uses the platform's own locale data rather than a hand-kept table: `Intl`
 * knows all 249 of them and stays current, and a list maintained here would
 * be wrong the first time a venue turns up somewhere unexpected. Falls back to
 * the code when the runtime lacks `DisplayNames` or the code is not real.
 */
export function countryLabel(code: string | null | undefined): string {
  if (!code) return "";
  const upper = code.toUpperCase();
  try {
    const names = new Intl.DisplayNames(["en"], { type: "region" });
    return names.of(upper) ?? upper;
  } catch {
    return upper;
  }
}

/** "Elkhart Lake, Wisconsin, United States" — as much as is known, in order. */
export function placeLabel(place: {
  city?: string | null;
  region?: string | null;
  country?: string | null;
}): string | null {
  const parts = [
    place.city?.trim() || null,
    place.region ? (REGION_LABELS[place.region] ?? place.region) : null,
    place.country ? countryLabel(place.country) : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
}
