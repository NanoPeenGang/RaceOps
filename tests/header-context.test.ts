import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guards on the header's two client components.
 *
 * These are source checks rather than behaviour tests because what they are
 * protecting is a build-time property, and the build takes long enough that
 * catching it here is worth the ugliness of reading the file.
 *
 * The trap: `useSearchParams` opts every page rendering the component out of
 * prerendering unless a Suspense boundary sits above it. The switcher needs
 * the query string — it lands you on the same tab of whatever you switch to —
 * but the mobile menu only needs to know *whether* you are in a context, and
 * routing that question through the search params broke the build on two
 * pages the first time this shipped.
 */

const SRC = join(process.cwd(), "src", "components");
const switcher = readFileSync(join(SRC, "context-switcher.tsx"), "utf8");
const mobileNav = readFileSync(join(SRC, "mobile-nav.tsx"), "utf8");

function bodyOf(source: string, name: string): string {
  const start = source.indexOf(`function ${name}(`);
  expect(start, `${name} should exist`).toBeGreaterThan(-1);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open, index + 1);
    }
  }
  throw new Error(`could not find the end of ${name}`);
}

describe("the header context switcher", () => {
  it("reads the query string only in the hook that needs it", () => {
    expect(bodyOf(switcher, "useTabRoute")).toContain("useSearchParams");
    expect(bodyOf(switcher, "usePathRoute")).not.toContain("useSearchParams");
  });

  it("checks itself: the extractor really reads a body", () => {
    // A parser that quietly returns nothing makes every assertion above pass.
    expect(bodyOf(switcher, "usePathRoute")).toContain("usePathname");
  });

  it("answers 'am I in a context' without the query string", () => {
    const body = bodyOf(switcher, "useInContext");
    expect(body).toContain("usePathRoute");
    expect(body).not.toContain("useTabRoute");
  });

  it("puts a Suspense boundary above the part that reads it", () => {
    const body = bodyOf(switcher, "HeaderContext");
    expect(body).toContain("Suspense");
    expect(body).toContain("fallback");
  });

  it("falls back to the directory links rather than to nothing", () => {
    // A blank left-hand header while the boundary resolves reads as a broken
    // page; the links are what was there a moment ago anyway.
    expect(bodyOf(switcher, "HeaderContext")).toContain("<DirectoryLinks />");
  });
});

describe("the mobile menu", () => {
  it("never reaches for the query string", () => {
    expect(mobileNav).not.toContain("useSearchParams");
  });

  it("stops hiding on desktop once the directory links step aside", () => {
    /*
     * The one thing that must not break: when the header swaps the links for
     * the switcher, this button is the only remaining route to the directory
     * on a desktop. Hard-coding `lg:hidden` again would strand every one of
     * those destinations behind ⌘K alone.
     */
    expect(mobileNav).toContain("useInContext");
    expect(mobileNav).toContain('!inContext && "lg:hidden"');
  });
});
