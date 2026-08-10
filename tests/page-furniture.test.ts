import { globSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Keeping the consoles recognisable.
 *
 * The primitives in `components/ui/page.tsx` were built so somebody learning
 * the platform could *recognise* a screen instead of re-reading it — and then
 * only ten of forty-four pages used them, so `/search` opened with bare markup
 * while `/apply` next door had breadcrumbs, a description and a proper empty
 * state. Consistency that is nobody's job drifts back within a release.
 *
 * This is a shape check, not a design review: it asks whether a page states
 * what it is at the top, not whether it does so well.
 */

const APP = join(process.cwd(), "src/app/(dashboard)");

/**
 * Pages that deliberately do not carry the console furniture.
 *
 * Every one is used standing up, on a phone, by somebody whose whole job for
 * the next four hours is that one screen — a gate, a scanner, a timing board.
 * Breadcrumbs and a description are screen those people do not have, and the
 * generic pass would make these worse by making them look like everything
 * else. Print views are excluded for the opposite reason: they are paper.
 */
const DELIBERATELY_BARE = [
  "events/[eventId]/gate/page.tsx",
  "events/[eventId]/timing/page.tsx",
  "events/[eventId]/broadcast/page.tsx",
  "events/[eventId]/print/[document]/page.tsx",
  "teams/[slug]/scan/page.tsx",
  "teams/[slug]/labels/page.tsx",
  // A document that gets printed or saved to PDF and emailed to a customer.
  // Console breadcrumbs on somebody's invoice would be as wrong as they sound.
  "teams/[slug]/invoices/[invoiceId]/page.tsx",
  "parts/[kind]/[token]/page.tsx",
  "passes/[credentialId]/page.tsx",
  // A branded public landing page: it renders the team's own colours and logo
  // through BrandHeader, which is the point of it. The console furniture would
  // put RaceOps' chrome on top of somebody's identity.
  "teams/[slug]/page.tsx",
];

function pages(): string[] {
  return globSync("**/page.tsx", { cwd: APP }).sort();
}

describe("page furniture", () => {
  it("finds the pages it is meant to be checking", () => {
    // Fails loudly if the route layout moves and this silently covers nothing.
    expect(pages().length).toBeGreaterThanOrEqual(20);
  });

  it("states what the page is, at the top of it", () => {
    const missing = pages().filter((page) => {
      if (DELIBERATELY_BARE.includes(page)) return false;
      const source = readFileSync(join(APP, page), "utf8");
      // Either the page renders the header itself, or it hands off to a
      // component that does — a console split across files is still one page.
      return !source.includes("PageHeader") && !/from "\.\//.test(source);
    });
    expect(missing).toEqual([]);
  });

  it("does not exempt a page that no longer exists", () => {
    // A stale entry would silently exempt a future page that reused the path,
    // which is the drift this file exists to catch, through its own back door.
    const present = new Set(pages());
    for (const bare of DELIBERATELY_BARE) {
      expect(present.has(bare), `${bare} is exempted but missing`).toBe(true);
    }
  });

  it("has not left a hand-rolled page heading behind", () => {
    /*
     * The specific markup every page used to invent for itself. One is left,
     * on the profile page, where the name sits beside a large avatar rather
     * than above a description — a shape the header does not have a slot for.
     */
    const handRolled = pages().filter((page) =>
      readFileSync(join(APP, page), "utf8").includes(
        '<h1 className="text-3xl font-bold"',
      ),
    );
    expect(handRolled.length).toBeLessThanOrEqual(1);
  });
});
