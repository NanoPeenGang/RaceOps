import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ACCOUNT_LINKS, NAV_LINKS } from "@/lib/nav";

/**
 * Guards the regression where dashboard routes existed but were unreachable
 * on phones (the desktop-only header nav was the sole entry point).
 * Every top-level authenticated route must appear in the shared nav
 * definitions, which the mobile menu renders in full.
 */
const DASHBOARD_DIR = join(process.cwd(), "src/app/(dashboard)");

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
  ]);

  it("exposes every top-level dashboard route in the shared nav", () => {
    const missing = topLevelRoutes().filter((route) => {
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

  it("uses absolute, non-duplicated hrefs", () => {
    const all = [...NAV_LINKS, ...ACCOUNT_LINKS].map((l) => l.href);
    for (const href of all) expect(href.startsWith("/")).toBe(true);
    expect(new Set(all).size).toBe(all.length);
  });
});
