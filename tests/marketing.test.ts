import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AUDIENCE_PATHS,
  CAPABILITY_GROUPS,
  DISCIPLINE_POINTS,
  marketingLinks,
} from "@/lib/marketing";

/**
 * The landing page is the one page a stranger sees. A dead link on it is worse
 * than a dead link anywhere else, so every destination is checked against the
 * routes that actually exist on disk.
 */
const APP_DIR = join(process.cwd(), "src/app");

function routeExists(href: string): boolean {
  const segment = href.replace(/^\//, "");
  // Landing links are top-level destinations inside a route group.
  return readdirSync(APP_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("("))
    .some((group) =>
      existsSync(join(APP_DIR, group.name, segment, "page.tsx")),
    );
}

describe("landing page links", () => {
  it("points every path at a route that exists", () => {
    const broken = marketingLinks().filter((href) => !routeExists(href));
    expect(broken).toEqual([]);
  });

  it("uses absolute internal hrefs", () => {
    for (const href of marketingLinks()) {
      expect(href.startsWith("/"), href).toBe(true);
    }
  });

  it("finds the app routes it is meant to be checking", () => {
    // Fails loudly if the directory layout moves and the scan starts
    // vacuously passing.
    expect(routeExists("/opportunities")).toBe(true);
    expect(routeExists("/definitely-not-a-route")).toBe(false);
  });
});

describe("landing page content", () => {
  it("covers every job the platform is positioned around", () => {
    // Guards the repositioning: this is not a sim-to-real pipeline page. If a
    // pillar is dropped, the page stops describing the product.
    const text = AUDIENCE_PATHS.map(
      (path) => `${path.action} ${path.audience} ${path.body}`,
    )
      .join(" ")
      .toLowerCase();

    for (const pillar of [
      "series",
      "race weekend",
      "team",
      "seat",
      "crew",
      "volunteer",
      "sponsorship",
    ]) {
      expect(text, pillar).toContain(pillar);
    }
  });

  it("treats sim and real world as peers rather than a funnel", () => {
    const text = DISCIPLINE_POINTS.map((p) => `${p.title} ${p.body}`)
      .join(" ")
      .toLowerCase();
    expect(text).toContain("sim");
    expect(text).toContain("real");
    // "Stepping stone" appears only as the claim being rejected.
    expect(text).toContain("not a stepping stone");
  });

  it("gives every card the copy the layout renders", () => {
    for (const path of AUDIENCE_PATHS) {
      expect(path.action.length, path.action).toBeGreaterThan(3);
      expect(path.audience.length, path.action).toBeGreaterThan(3);
      expect(path.body.length, path.action).toBeGreaterThan(20);
      expect(path.cta.length, path.action).toBeGreaterThan(3);
    }
    for (const group of CAPABILITY_GROUPS) {
      expect(group.bullets.length, group.title).toBeGreaterThanOrEqual(4);
      expect(group.lede.length, group.title).toBeGreaterThan(20);
    }
  });

  it("does not repeat an audience card action", () => {
    const actions = AUDIENCE_PATHS.map((path) => path.action);
    expect(new Set(actions).size).toBe(actions.length);
  });
});
