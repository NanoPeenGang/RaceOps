import { describe, expect, it } from "vitest";
import {
  AA_CONTRAST,
  contrastRatio,
  contrastWarning,
  contrastWarnings,
  DEFAULT_THEME,
  hexToRgb,
  mix,
  normalizeHex,
  readableOn,
  relativeLuminance,
  resolveBranding,
  rgbToHex,
  themeStyle,
} from "@/lib/branding";

describe("normalizeHex", () => {
  it("accepts the forms people actually paste", () => {
    expect(normalizeHex("#d91e1e")).toBe("#D91E1E");
    expect(normalizeHex("D91E1E")).toBe("#D91E1E");
    expect(normalizeHex("#abc")).toBe("#AABBCC");
    expect(normalizeHex("  #FFF  ")).toBe("#FFFFFF");
  });

  it("returns null rather than a fallback for invalid input", () => {
    // The form needs to tell "not set" from "set to nonsense", so it can warn
    // instead of silently reverting to red.
    expect(normalizeHex("rebeccapurple")).toBeNull();
    expect(normalizeHex("#12345")).toBeNull();
    expect(normalizeHex("")).toBeNull();
    expect(normalizeHex(null)).toBeNull();
  });
});

describe("rgb conversion", () => {
  it("round-trips", () => {
    expect(rgbToHex(hexToRgb("#D91E1E"))).toBe("#D91E1E");
  });

  it("clamps rather than wrapping out-of-range channels", () => {
    expect(rgbToHex({ r: 300, g: -20, b: 128 })).toBe("#FF0080");
  });
});

describe("relativeLuminance", () => {
  it("puts black and white at the ends", () => {
    expect(relativeLuminance("#000000")).toBeCloseTo(0, 5);
    expect(relativeLuminance("#FFFFFF")).toBeCloseTo(1, 5);
  });

  it("weights green far above blue, as perception does", () => {
    // A naive average of R, G and B calls yellow dark and blue light, which
    // is backwards — and is how white text ends up on yellow.
    expect(relativeLuminance("#00FF00")).toBeGreaterThan(
      relativeLuminance("#0000FF"),
    );
    expect(relativeLuminance("#FFFF00")).toBeGreaterThan(0.9);
  });
});

describe("contrastRatio", () => {
  it("spans 1 to 21", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 1);
    expect(contrastRatio("#123456", "#123456")).toBeCloseTo(1, 5);
  });

  it("is symmetric", () => {
    expect(contrastRatio("#D91E1E", "#FFFFFF")).toBeCloseTo(
      contrastRatio("#FFFFFF", "#D91E1E"),
      5,
    );
  });
});

describe("readableOn", () => {
  it("puts dark text on a pale brand colour", () => {
    // The case this whole module exists for: a club picking pale gold from a
    // letterhead must not get white text.
    expect(readableOn("#FFE680")).toBe("#0A0A0A");
    expect(readableOn("#FFFF00")).toBe("#0A0A0A");
    expect(readableOn("#FFFFFF")).toBe("#0A0A0A");
  });

  it("puts light text on a dark brand colour", () => {
    expect(readableOn("#0A0A0A")).toBe("#FFFFFF");
    expect(readableOn("#1E3A8A")).toBe("#FFFFFF");
    expect(readableOn(DEFAULT_THEME.primary)).toBe("#FFFFFF");
  });

  it("always picks whichever contrasts more", () => {
    for (const colour of ["#808080", "#7F7F7F", "#00A3A3", "#5C3D2E"]) {
      const chosen = readableOn(colour);
      const other = chosen === "#FFFFFF" ? "#0A0A0A" : "#FFFFFF";
      expect(contrastRatio(colour, chosen)).toBeGreaterThanOrEqual(
        contrastRatio(colour, other),
      );
    }
  });
});

describe("contrastWarnings", () => {
  it("says nothing for a colour that works both ways", () => {
    expect(contrastWarnings("#D91E1E")).toEqual([]);
    expect(contrastWarnings("#000000")).toEqual([]);
    expect(contrastWarnings("#1E3A8A")).toEqual([]);
  });

  it("warns when neither black nor white can sit on it", () => {
    // A narrow band: #777777 is the worst possible grey at 4.48:1.
    const warnings = contrastWarnings("#777777");
    expect(warnings.some((w) => w.includes("sitting on this colour"))).toBe(
      true,
    );
    expect(warnings[0]).toContain(String(AA_CONTRAST));
    expect(warnings[0]).toContain("darker or lighter");
  });

  it("warns when the colour vanishes against the page as a foreground", () => {
    // The failure the obvious check misses: text on pale gold is perfectly
    // readable, and every link rendered in pale gold is invisible.
    const warnings = contrastWarnings("#FFE680");
    expect(warnings.some((w) => w.includes("against the page"))).toBe(true);
    expect(contrastWarnings("#FFFFFF").length).toBeGreaterThan(0);
  });

  it("says a pale colour still works as a background", () => {
    // It is their brand: the message has to say what still works, not just
    // what does not.
    expect(contrastWarnings("#FFE680").join(" ")).toContain(
      "still work as a background",
    );
  });

  it("exposes one line for a form that shows one", () => {
    expect(contrastWarning("#D91E1E")).toBeNull();
    expect(contrastWarning("#FFE680")).toBeTruthy();
  });
});

describe("resolveBranding", () => {
  it("falls back to the RaceOps palette with nothing set", () => {
    const branding = resolveBranding(null, undefined);
    expect(branding.primary).toBe(DEFAULT_THEME.primary);
    expect(branding.isDefault).toBe(true);
    expect(branding.logoUrl).toBeNull();
  });

  it("takes the nearest layer that sets a field", () => {
    const branding = resolveBranding(
      { logoUrl: "event.png" },
      { logoUrl: "series.png", primaryColor: "#1E3A8A" },
      { logoUrl: "org.png", primaryColor: "#000000" },
    );
    expect(branding.logoUrl).toBe("event.png");
    expect(branding.primary).toBe("#1E3A8A");
  });

  it("resolves each field independently", () => {
    // An event that sets only a banner must keep its series' colours; whole-
    // object fallback would mean setting one field discarded the rest.
    const branding = resolveBranding(
      { bannerUrl: "event-banner.jpg" },
      { logoUrl: "series.png", primaryColor: "#1E3A8A", tagline: "Race hard" },
    );
    expect(branding.bannerUrl).toBe("event-banner.jpg");
    expect(branding.logoUrl).toBe("series.png");
    expect(branding.primary).toBe("#1E3A8A");
    expect(branding.tagline).toBe("Race hard");
  });

  it("skips a layer that set a field to blank", () => {
    const branding = resolveBranding(
      { logoUrl: "   ", primaryColor: "" },
      { logoUrl: "series.png", primaryColor: "#1E3A8A" },
    );
    expect(branding.logoUrl).toBe("series.png");
    expect(branding.primary).toBe("#1E3A8A");
  });

  it("ignores an invalid colour rather than rendering it", () => {
    const branding = resolveBranding({ primaryColor: "not-a-colour" });
    expect(branding.primary).toBe(DEFAULT_THEME.primary);
  });

  it("computes a readable foreground for whatever was chosen", () => {
    expect(resolveBranding({ primaryColor: "#FFE680" }).onPrimary).toBe(
      "#0A0A0A",
    );
    expect(resolveBranding({ primaryColor: "#1E3A8A" }).onPrimary).toBe(
      "#FFFFFF",
    );
  });

  it("does not call a customised theme default", () => {
    expect(resolveBranding({ primaryColor: "#1E3A8A" }).isDefault).toBe(false);
  });
});

describe("mix", () => {
  it("interpolates between two colours", () => {
    expect(mix("#000000", "#FFFFFF", 0.5)).toBe("#808080");
    expect(mix("#000000", "#FFFFFF", 0)).toBe("#000000");
    expect(mix("#000000", "#FFFFFF", 1)).toBe("#FFFFFF");
  });

  it("clamps a weight outside 0..1", () => {
    expect(mix("#000000", "#FFFFFF", 5)).toBe("#FFFFFF");
    expect(mix("#000000", "#FFFFFF", -2)).toBe("#000000");
  });
});

describe("themeStyle", () => {
  it("emits custom properties that can be scoped to one element", () => {
    // Scoped rather than global: a global stylesheet would leak one series'
    // colours onto another's card in a mixed list.
    const style = themeStyle(resolveBranding({ primaryColor: "#1E3A8A" }));
    expect(style["--brand-primary"]).toBe("#1E3A8A");
    expect(style["--brand-on-primary"]).toBe("#FFFFFF");
    expect(style["--brand-primary-soft"]).toBeTruthy();
  });
});
