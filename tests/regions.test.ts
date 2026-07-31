import { describe, expect, it } from "vitest";
import { REGION_LABELS, countryLabel, placeLabel } from "@/lib/regions";

describe("countryLabel", () => {
  it("expands an ISO code", () => {
    expect(countryLabel("US")).toBe("United States");
    expect(countryLabel("be")).toBe("Belgium");
  });

  it("passes through something that is not a country", () => {
    // Better a stray code on screen than a crash on a page listing venues.
    // (Not "ZZ" — that is CLDR's reserved code for an unknown region and
    // expands to "Unknown Region", which is correct rather than a fallback.)
    expect(countryLabel("QQ")).toBe("QQ");
  });

  it("is empty for nothing, not the word 'null'", () => {
    expect(countryLabel(null)).toBe("");
    expect(countryLabel("")).toBe("");
  });
});

describe("REGION_LABELS", () => {
  it("covers the US states", () => {
    expect(REGION_LABELS.WI).toBe("Wisconsin");
    expect(REGION_LABELS.NY).toBe("New York");
    // 50 states plus DC.
    expect(Object.keys(REGION_LABELS)).toHaveLength(51);
  });
});

describe("placeLabel", () => {
  it("reads as an address, expanding what it recognises", () => {
    expect(
      placeLabel({ city: "Elkhart Lake", region: "WI", country: "US" }),
    ).toBe("Elkhart Lake, Wisconsin, United States");
  });

  it("passes an unrecognised region through unchanged", () => {
    // A Belgian club typing "Liège" should see "Liège", not have to wait for
    // somebody to add it to a table.
    expect(placeLabel({ city: "Stavelot", region: "Liège", country: "BE" })).toBe(
      "Stavelot, Liège, Belgium",
    );
  });

  it("skips what is missing rather than leaving gaps", () => {
    expect(placeLabel({ city: "Monterey", country: "US" })).toBe(
      "Monterey, United States",
    );
    expect(placeLabel({ region: "TX" })).toBe("Texas");
  });

  it("is null when nothing is known, so the caller can say so", () => {
    expect(placeLabel({})).toBeNull();
    expect(placeLabel({ city: "   ", region: null, country: null })).toBeNull();
  });
});
