import { describe, expect, it } from "vitest";
import { LayoutShape, TrackDirection } from "@prisma/client";
import {
  formatBanking,
  formatCoordinates,
  formatElevation,
  formatTurns,
  hasCoordinates,
  layoutDiagram,
  mapUrl,
  shapeLabel,
  venueMapUrl,
} from "@/lib/track-diagram";

describe("layoutDiagram", () => {
  it("draws every shape it claims to know", () => {
    for (const shape of Object.values(LayoutShape)) {
      const diagram = layoutDiagram({ shape });
      expect(diagram, shape).not.toBeNull();
      // A path that does not close is a track with a gap in it.
      expect(diagram!.path.trim().endsWith("Z"), shape).toBe(true);
      expect(diagram!.path.startsWith("M "), shape).toBe(true);
    }
  });

  it("refuses to draw a layout with no shape", () => {
    // This is the road-course case, and the refusal is the point: there is no
    // function from "4 km, 14 turns" to the outline of a circuit, so anything
    // drawn here would be a fabricated map under a real venue's name.
    expect(layoutDiagram({})).toBeNull();
    expect(layoutDiagram({ shape: null })).toBeNull();
    expect(
      layoutDiagram({ direction: TrackDirection.CLOCKWISE, bankingDegrees: 12 }),
    ).toBeNull();
  });

  it("points the arrow the way the cars actually go", () => {
    const cw = layoutDiagram({
      shape: LayoutShape.OVAL,
      direction: TrackDirection.CLOCKWISE,
    });
    const ccw = layoutDiagram({
      shape: LayoutShape.OVAL,
      direction: TrackDirection.ANTICLOCKWISE,
    });
    expect(cw!.arrow.pointsRight).toBe(true);
    expect(ccw!.arrow.pointsRight).toBe(false);
  });

  it("puts the arrow inside the drawing", () => {
    const diagram = layoutDiagram({ shape: LayoutShape.TRI_OVAL })!;
    const [, , width, height] = diagram.viewBox.split(" ").map(Number);
    // Leave room for the arrow head and barbs, which extend past the anchor.
    expect(diagram.arrow.x).toBeGreaterThan(15);
    expect(diagram.arrow.x).toBeLessThan(width - 15);
    expect(diagram.arrow.y).toBeGreaterThan(0);
    expect(diagram.arrow.y).toBeLessThan(height);
  });

  it("keeps every shape inside the viewBox", () => {
    // A path that overflows gets clipped, which reads as a broken diagram.
    const [, , width, height] = "0 0 200 132".split(" ").map(Number);
    for (const shape of Object.values(LayoutShape)) {
      const numbers = layoutDiagram({ shape })!
        .path.match(/-?\d+(\.\d+)?/g)!
        .map(Number);
      expect(Math.min(...numbers), shape).toBeGreaterThanOrEqual(0);
      expect(Math.max(...numbers), shape).toBeLessThanOrEqual(
        Math.max(width, height),
      );
    }
  });

  it("describes itself for a screen reader", () => {
    const diagram = layoutDiagram({
      shape: LayoutShape.TRI_OVAL,
      direction: TrackDirection.ANTICLOCKWISE,
      bankingDegrees: 33,
    })!;
    expect(diagram.label).toBe(
      "Schematic of a tri-oval, run anticlockwise, with 33-degree banking",
    );
  });

  it("leaves banking out of the description when it is not known", () => {
    const diagram = layoutDiagram({ shape: LayoutShape.OVAL })!;
    expect(diagram.label).not.toContain("banking");
  });
});

describe("shapeLabel", () => {
  it("names every shape, capitalised for a spec list", () => {
    for (const shape of Object.values(LayoutShape)) {
      const label = shapeLabel(shape);
      expect(label[0], shape).toBe(label[0].toUpperCase());
      expect(label.length, shape).toBeGreaterThan(3);
    }
    expect(shapeLabel(LayoutShape.PAPERCLIP)).toBe("Paperclip oval");
  });
});

describe("formatters", () => {
  it("pluralises turns", () => {
    expect(formatTurns(14)).toBe("14 turns");
    expect(formatTurns(1)).toBe("1 turn");
  });

  it("says nothing rather than zero when a figure is unknown", () => {
    // "0 turns" on a circuit that plainly has corners reads as broken data.
    expect(formatTurns(null)).toBeNull();
    expect(formatTurns(undefined)).toBeNull();
    expect(formatTurns(0)).toBeNull();
    expect(formatElevation(0)).toBeNull();
    expect(formatElevation(null)).toBeNull();
  });

  it("distinguishes flat from unknown banking", () => {
    // Zero degrees is a real and meaningful answer for a flat oval, unlike
    // zero turns — so it renders, and null does not.
    expect(formatBanking(0)).toBe("Flat");
    expect(formatBanking(33)).toBe("33° banking");
    expect(formatBanking(null)).toBeNull();
  });
});

describe("coordinates", () => {
  it("accepts a real position", () => {
    expect(hasCoordinates({ latitude: 43.7986, longitude: -87.9903 })).toBe(true);
  });

  it("rejects a half-filled or out-of-range pair", () => {
    expect(hasCoordinates({ latitude: 43.8 })).toBe(false);
    expect(hasCoordinates({ latitude: 43.8, longitude: null })).toBe(false);
    expect(hasCoordinates({ latitude: 91, longitude: 0 })).toBe(false);
    expect(hasCoordinates({ latitude: 0, longitude: 181 })).toBe(false);
    expect(hasCoordinates({ latitude: NaN, longitude: 12 })).toBe(false);
  });

  it("rejects null island", () => {
    // 0,0 is in the Gulf of Guinea and is almost always an unset field that
    // got saved as a number. A pin there is worse than no pin.
    expect(hasCoordinates({ latitude: 0, longitude: 0 })).toBe(false);
  });

  it("formats to a sane precision", () => {
    expect(formatCoordinates({ latitude: 43.7986, longitude: -87.9903 })).toBe(
      "43.79860, -87.99030",
    );
    expect(formatCoordinates({ latitude: 1 })).toBeNull();
  });
});

describe("map links", () => {
  it("pins coordinates when there are any", () => {
    expect(mapUrl({ latitude: 43.7986, longitude: -87.9903 })).toContain(
      "query=43.7986,-87.9903",
    );
    expect(mapUrl({})).toBeNull();
  });

  it("falls back to searching by name, which is never a wrong pin", () => {
    const url = venueMapUrl({
      name: "Road America",
      city: "Elkhart Lake",
      region: "WI",
      country: "US",
    });
    expect(url).toContain("Road%20America");
    expect(url).toContain("Elkhart%20Lake");
  });

  it("prefers coordinates over the name search", () => {
    const url = venueMapUrl({
      name: "Road America",
      city: "Elkhart Lake",
      latitude: 43.7986,
      longitude: -87.9903,
    });
    expect(url).toContain("43.7986");
    expect(url).not.toContain("Elkhart");
  });

  it("escapes a name that would otherwise break the query", () => {
    const url = venueMapUrl({ name: "Alan's Track & Raceway #1" });
    expect(url).not.toContain("&Raceway");
    expect(url).toContain("%26");
  });
});
