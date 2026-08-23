import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EVENT_CONSOLE_PAGES, TEAM_CONSOLE_PAGES } from "@/lib/nav";

/**
 * The console rail.
 *
 * These are source checks. What they protect is structural — which component
 * a console renders, and whether the pages beside it are linked at all — and
 * that is not something a unit test of the component can tell you, because
 * the component is fine and the console is what forgets to use it.
 */

const DASHBOARD = join(process.cwd(), "src", "app", "(dashboard)");
const rail = readFileSync(join(process.cwd(), "src/components/ui/console.tsx"), "utf8");

const CONSOLES = [
  { name: "team", path: "teams/[slug]/manage/page.tsx" },
  { name: "event", path: "events/[eventId]/manage/page.tsx" },
  { name: "series", path: "series/[slug]/manage/page.tsx" },
];

describe("every console uses the rail", () => {
  for (const console_ of CONSOLES) {
    it(console_.name, () => {
      const source = readFileSync(join(DASHBOARD, console_.path), "utf8");
      expect(source).toContain("<Console");
      // The bare strip is the phone fallback the rail renders for itself; a
      // console reaching for it directly has gone back to the old shape.
      expect(source).not.toContain("<Tabs");
    });

    it(`${console_.name} links the pages beside it`, () => {
      const source = readFileSync(join(DASHBOARD, console_.path), "utf8");
      expect(source).toContain("pages={");
      expect(source).toContain("pagesLabel=");
    });
  }
});

describe("the rail itself", () => {
  it("keeps the strip for phones", () => {
    /*
     * A sidebar on a phone takes a third of the screen before any content
     * appears. Dropping the strip would trade one findability problem for a
     * worse one on the device most likely to be trackside.
     */
    expect(rail).toContain("<TabStrip");
    expect(rail).toContain("lg:hidden");
  });

  it("shows the sibling pages on a phone too", () => {
    // Rendering them only inside the desktop rail would put the gate screen
    // back exactly where it was: nowhere.
    const mobileBlock = rail.slice(rail.indexOf("mt-8 border-t"));
    expect(mobileBlock).toContain("pages.map");
  });

  it("marks the selected tab for a screen reader, not only in colour", () => {
    expect(rail).toContain('role="tab"');
    expect(rail).toContain("aria-selected={isActive}");
    expect(rail).toContain('aria-orientation="vertical"');
  });

  it("points each tab at the panel it controls", () => {
    expect(rail).toContain("aria-controls={`panel-${tab.id}`}");
    expect(rail).toContain("aria-labelledby={`rail-${current.id}`}");
  });

  it("sticks under the header rather than scrolling away", () => {
    expect(rail).toContain("sticky");
    expect(rail).toContain("overflow-y-auto");
  });
});

describe("the pages beside a console are real routes", () => {
  it("team", () => {
    expect(TEAM_CONSOLE_PAGES.length).toBeGreaterThan(0);
    for (const page of TEAM_CONSOLE_PAGES) {
      expect(page.label.length).toBeGreaterThan(0);
    }
  });

  it("event, including the gate screen nothing else links", () => {
    const segments = EVENT_CONSOLE_PAGES.map((page) => page.segment);
    expect(segments).toContain("gate");
  });
});
