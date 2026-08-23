import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ACCOUNT_LINKS,
  ADMIN_LINKS,
  EVENT_CONSOLE_PAGES,
  EVENT_CONSOLE_TABS,
  NAV_LINKS,
  SERIES_CONSOLE_TABS,
  TEAM_CONSOLE_PAGES,
  TEAM_CONSOLE_TABS,
  type ConsoleTab,
} from "@/lib/nav";

/**
 * The console tab lists live in two places, and this is what keeps them equal.
 *
 * `nav.ts` names the tabs so the command palette can point at them; the
 * console pages build the real ones, because a tab also carries content, a
 * visibility rule and a badge, none of which belong in a nav constant.
 *
 * Duplication is the tradeoff, and duplication drifts. Add a tab to a console
 * and this fails until it is named in `nav.ts` too — at which point it is
 * findable, which is the entire point of having the list twice.
 */

const DASHBOARD = join(process.cwd(), "src", "app", "(dashboard)");

function tabsDeclaredIn(relativePath: string): ConsoleTab[] {
  const source = readFileSync(join(DASHBOARD, relativePath), "utf8");
  const pattern = /id:\s*"([A-Za-z0-9_-]+)",\s*\n\s*label:\s*"([^"]+)"/g;
  const found: ConsoleTab[] = [];
  for (const match of source.matchAll(pattern)) {
    found.push({ id: match[1]!, label: match[2]! });
  }
  return found;
}

const CONSOLES: { name: string; path: string; declared: readonly ConsoleTab[] }[] = [
  { name: "team", path: "teams/[slug]/manage/page.tsx", declared: TEAM_CONSOLE_TABS },
  { name: "event", path: "events/[eventId]/manage/page.tsx", declared: EVENT_CONSOLE_TABS },
  { name: "series", path: "series/[slug]/manage/page.tsx", declared: SERIES_CONSOLE_TABS },
];

describe("console tabs match the pages that render them", () => {
  for (const console_ of CONSOLES) {
    it(`${console_.name} console`, () => {
      const actual = tabsDeclaredIn(console_.path);

      // A parser that silently finds nothing would make this test pass for
      // the wrong reason, which is the failure mode of every source scraper.
      expect(actual.length).toBeGreaterThan(0);

      expect(actual).toEqual([...console_.declared]);
    });
  }
});

describe("every command points at a route that exists", () => {
  function routeExists(href: string): boolean {
    const path = href.split("?")[0]!.replace(/^\//, "");
    if (path === "") return true;
    return (
      existsSync(join(DASHBOARD, path, "page.tsx")) ||
      existsSync(join(process.cwd(), "src", "app", path, "page.tsx"))
    );
  }

  it("checks itself against a route it knows is missing", () => {
    expect(routeExists("/definitely-not-a-page")).toBe(false);
    expect(routeExists("/home")).toBe(true);
  });

  for (const link of [...NAV_LINKS, ...ACCOUNT_LINKS, ...ADMIN_LINKS]) {
    it(`${link.label} → ${link.href}`, () => {
      expect(routeExists(link.href)).toBe(true);
    });
  }

  for (const page of TEAM_CONSOLE_PAGES) {
    it(`team ${page.label} → /${page.segment}`, () => {
      expect(existsSync(join(DASHBOARD, "teams", "[slug]", page.segment, "page.tsx"))).toBe(
        true,
      );
    });
  }

  for (const page of EVENT_CONSOLE_PAGES) {
    it(`event ${page.label} → /${page.segment}`, () => {
      expect(
        existsSync(join(DASHBOARD, "events", "[eventId]", page.segment, "page.tsx")),
      ).toBe(true);
    });
  }
});
