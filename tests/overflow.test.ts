import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Menus you can reach the bottom of.
 *
 * The bug this exists for: the mobile menu grew to twenty destinations plus a
 * theme picker — taller than a phone screen — inside an absolutely positioned
 * panel with no height and no overflow. The bottom third was clipped with no
 * way to scroll to it, so those links were, in practice, gone. Nothing catches
 * that: it renders fine, it just ends early, and it only shows up on a short
 * screen with a long list.
 *
 * A structural check rather than a rendered one. Measuring a real panel would
 * mean a browser and a viewport size; the mistake that actually happened is
 * visible in the classes.
 */

const PANELS = [
  {
    file: "src/components/mobile-nav.tsx",
    what: "the mobile menu",
  },
  {
    file: "src/components/account-menu.tsx",
    what: "the account menu",
  },
];

describe("dropdowns can reach their own contents", () => {
  for (const panel of PANELS) {
    const source = readFileSync(join(process.cwd(), panel.file), "utf8");

    it(`gives ${panel.what} a height it cannot exceed`, () => {
      expect(source, `${panel.what} has no max-height`).toMatch(/max-h-\[/);
    });

    it(`lets ${panel.what} scroll`, () => {
      expect(source, `${panel.what} cannot scroll`).toContain("overflow-y-auto");
    });

    it(`measures ${panel.what} against the visible viewport`, () => {
      /*
       * `dvh`, not `vh`. On mobile `vh` is the viewport with the browser's
       * chrome hidden, so a panel sized in `vh` puts its last item behind the
       * URL bar — the fix looks like it did not work, which is worse than the
       * original bug because it looks fixed.
       */
      expect(source, `${panel.what} is sized in vh rather than dvh`).toContain(
        "dvh",
      );
      expect(source).not.toMatch(/max-h-\[calc\(100vh/);
    });

    it(`stops a flick in ${panel.what} scrolling the page behind it`, () => {
      expect(source).toContain("overscroll-contain");
    });
  }
});

describe("the tab bar says when there is more", () => {
  const source = readFileSync(
    join(process.cwd(), "src/components/ui/tabs.tsx"),
    "utf8",
  );

  it("still scrolls rather than wrapping", () => {
    // A wrapped set of seven tabs takes half a phone screen before any content
    // appears, which is why this scrolls in the first place.
    expect(source).toContain("overflow-x-auto");
  });

  it("only hints when the bar actually overflows", () => {
    // A permanent fade over the last tab on a desktop where everything fits is
    // a lie about content that is not there.
    expect(source).toContain("overflowing");
    expect(source).toContain("scrollWidth");
  });

  it("keeps the hint out of the way of a thumb", () => {
    expect(source).toContain("pointer-events-none");
  });
});
