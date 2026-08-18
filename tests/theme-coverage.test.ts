import { globSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Keeping the dark theme working.
 *
 * The theme works because the three brand tokens are *semantic* — `brand-black`
 * means ink, `brand-offwhite` means paper — and both swap. A literal colour
 * written straight into a component opts out of that silently: it looks right
 * while the author is in light mode, and is invisible or unreadable for
 * everybody else. That is the failure this catches, because nothing else does
 * until somebody reports a blank-looking page.
 */

const SRC = join(process.cwd(), "src");

/**
 * Places a literal colour is the right answer.
 *
 * Each is a case where the *content* dictates the colour rather than the
 * interface: circuit maps are dark line art on transparency and vanish on a
 * dark ground; an upload preview has to show the image where it will be used,
 * not where it is being uploaded; the landing hero is a brand statement whose
 * contents are written against a fixed dark band; and a QR code is only
 * scannable one way round.
 */
const LITERAL_BY_DESIGN = [
  "components/track-diagram.tsx",
  "components/track-gallery.tsx",
  "components/image-upload.tsx",
  "components/brand-theme.tsx",
  "app/(marketing)/page.tsx",
  "app/pass/[token]/page.tsx",
  "components/qr-scanner.tsx",
];

function sources(): string[] {
  return globSync("**/*.tsx", { cwd: SRC }).sort();
}

/** Utilities that pin a light ground and do not invert with the theme. */
const LIGHT_ONLY = /\b(?:bg-white|text-black|bg-gray-\d|bg-slate-\d|bg-neutral-\d|bg-zinc-\d)\b/;

describe("dark theme coverage", () => {
  it("finds the components it is meant to be checking", () => {
    expect(sources().length).toBeGreaterThanOrEqual(50);
  });

  it("has no light-only backgrounds outside the places that need them", () => {
    const offenders = sources().filter((file) => {
      if (LITERAL_BY_DESIGN.some((allowed) => file === allowed)) return false;
      return LIGHT_ONLY.test(readFileSync(join(SRC, file), "utf8"));
    });
    expect(offenders).toEqual([]);
  });

  it("does not exempt a file that no longer exists", () => {
    // A stale entry silently exempts a future file that reuses the path, which
    // is this test's own escape hatch widening on its own.
    const present = new Set(sources());
    for (const allowed of LITERAL_BY_DESIGN) {
      expect(present.has(allowed), `${allowed} is exempted but missing`).toBe(
        true,
      );
    }
  });

  it("pairs every filled brand block with a foreground that inverts too", () => {
    /*
     * `bg-brand-red text-white` reads fine in light and is unreadable in dark,
     * because the fill lifts for legibility against the page while the text
     * stays white. Both fills invert, so both need their own paired
     * foreground — `text-on-red` and `text-on-ink`.
     */
    const offenders: string[] = [];
    for (const file of sources()) {
      if (LITERAL_BY_DESIGN.includes(file)) continue;
      const source = readFileSync(join(SRC, file), "utf8");
      if (/bg-brand-(?:red|black)(?:\/\d+)?[^"'\n]*\btext-white\b/.test(source)) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});
