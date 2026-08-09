import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ACCOUNT_LINKS, ADMIN_LINKS, NAV_LINKS } from "@/lib/nav";

/**
 * Guards the regression where dashboard routes existed but were unreachable
 * on phones (the desktop-only header nav was the sole entry point).
 * Every top-level authenticated route must appear in the shared nav
 * definitions, which the mobile menu renders in full.
 */
const DASHBOARD_DIR = join(process.cwd(), "src/app/(dashboard)");

/**
 * Routes reached by scanning something, not by navigating.
 *
 * A part label's QR opens /parts/<kind>/<token> in whatever browser the phone's
 * camera hands it to. There is no menu entry to put it behind — nobody types
 * one of these, and a nav item reading "Parts" that opened a blank token page
 * would be worse than no entry at all.
 *
 * Kept as an explicit list rather than a pattern so adding one is a decision
 * somebody makes on purpose, which is the whole point of this test.
 */
const SCAN_TARGETS = new Set(["/parts"]);

function topLevelRoutes(): string[] {
  return readdirSync(DASHBOARD_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    // Route groups and dynamic segments aren't destinations themselves.
    .filter((entry) => !entry.name.startsWith("(") && !entry.name.startsWith("["))
    .map((entry) => `/${entry.name}`);
}

describe("navigation coverage", () => {
  const reachable = new Set<string>([
    ...NAV_LINKS.map((l) => l.href),
    ...ACCOUNT_LINKS.map((l) => l.href),
    // Staff-only, and rendered conditionally — but still has to be in the
    // mobile menu, or the queue is desktop-only.
    ...ADMIN_LINKS.map((l) => l.href),
  ]);

  it("exposes every top-level dashboard route in the shared nav", () => {
    const missing = topLevelRoutes().filter((route) => {
      if (SCAN_TARGETS.has(route)) return false;
      // A route counts as reachable if it, or a child page of it, is linked.
      return ![...reachable].some(
        (href) => href === route || href.startsWith(`${route}/`),
      );
    });
    expect(missing).toEqual([]);
  });

  it("finds the dashboard routes it is meant to be checking", () => {
    // Fails loudly if the directory layout moves and the scan silently
    // starts covering nothing.
    expect(topLevelRoutes().length).toBeGreaterThanOrEqual(6);
  });

  it("does not carry an exemption for a route that no longer exists", () => {
    // A stale entry here would silently exempt a future route that happened to
    // reuse the name — which is exactly the regression this file exists to
    // catch, reintroduced through its own escape hatch.
    const routes = new Set(topLevelRoutes());
    for (const target of SCAN_TARGETS) expect(routes.has(target)).toBe(true);
  });

  it("uses absolute, non-duplicated hrefs", () => {
    const all = [...NAV_LINKS, ...ACCOUNT_LINKS, ...ADMIN_LINKS].map(
      (l) => l.href,
    );
    for (const href of all) expect(href.startsWith("/")).toBe(true);
    expect(new Set(all).size).toBe(all.length);
  });
});
