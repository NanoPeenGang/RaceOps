import { describe, expect, it } from "vitest";
import { slugify } from "@/lib/slug";

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("Apex Racing Team")).toBe("apex-racing-team");
  });

  it("strips punctuation and collapses separators", () => {
    expect(slugify("GT3 // Endurance -- Squad!")).toBe("gt3-endurance-squad");
  });

  it("removes diacritics", () => {
    expect(slugify("Équipe Motorsport")).toBe("equipe-motorsport");
  });

  it("trims leading and trailing hyphens", () => {
    expect(slugify("  #1 Team  ")).toBe("1-team");
  });

  it("caps the length at 80 characters", () => {
    expect(slugify("x".repeat(200)).length).toBeLessThanOrEqual(80);
  });
});
