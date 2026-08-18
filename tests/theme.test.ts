import { describe, expect, it } from "vitest";
import { ThemePreference } from "@prisma/client";
import {
  followsDevice,
  parsePreference,
  resolveTheme,
  THEME_LABELS,
  THEME_ORDER,
  THEME_STORAGE_KEY,
  themeBootScript,
} from "@/lib/theme";

/**
 * Light, dark, or whatever the device says.
 *
 * The interesting part is the boot script. It runs before React exists, in a
 * bare `<script>`, so nothing can catch its mistakes at runtime — a throw there
 * leaves the page unstyled and a wrong answer is a face full of white on a
 * dark-mode phone at a night race.
 */

describe("resolving a preference", () => {
  it("obeys an explicit choice whatever the device says", () => {
    expect(resolveTheme(ThemePreference.LIGHT, true)).toBe("light");
    expect(resolveTheme(ThemePreference.DARK, false)).toBe("dark");
  });

  it("follows the device when asked to", () => {
    expect(resolveTheme(ThemePreference.SYSTEM, true)).toBe("dark");
    expect(resolveTheme(ThemePreference.SYSTEM, false)).toBe("light");
  });

  it("only repaints on a device change while following it", () => {
    // Somebody who explicitly chose light does not want their laptop's sunset
    // schedule overruling them at six o'clock.
    expect(followsDevice(ThemePreference.SYSTEM)).toBe(true);
    expect(followsDevice(ThemePreference.LIGHT)).toBe(false);
    expect(followsDevice(ThemePreference.DARK)).toBe(false);
  });
});

describe("reading what was stored", () => {
  it("takes the three it knows", () => {
    expect(parsePreference("LIGHT")).toBe(ThemePreference.LIGHT);
    expect(parsePreference("DARK")).toBe(ThemePreference.DARK);
    expect(parsePreference("SYSTEM")).toBe(ThemePreference.SYSTEM);
  });

  it("falls back rather than throwing on anything else", () => {
    /*
     * This runs inside the boot script, where an exception leaves the page
     * unstyled. A stale value from an older build, or one somebody edited by
     * hand, is not worth that.
     */
    for (const junk of [null, "", "midnight", "dark", "TRUE", "{}"]) {
      expect(parsePreference(junk)).toBe(ThemePreference.SYSTEM);
    }
  });

  it("defaults to following the device", () => {
    // Most people set this once at the operating system and expect everything
    // to obey it without being asked again.
    expect(parsePreference(null)).toBe(ThemePreference.SYSTEM);
    expect(THEME_ORDER[0]).toBe(ThemePreference.SYSTEM);
  });
});

describe("the script that runs before first paint", () => {
  const script = themeBootScript();

  /** Runs the boot script against a fake document and storage. */
  function boot(stored: string | null, prefersDark: boolean): string | null {
    let attribute: string | null = null;
    const document = {
      documentElement: {
        setAttribute: (_name: string, value: string) => {
          attribute = value;
        },
      },
    };
    const window = {
      matchMedia: (query: string) => ({
        matches: query.includes("dark") && prefersDark,
      }),
    };
    const localStorage = { getItem: () => stored };
    new Function("document", "window", "localStorage", script)(
      document,
      window,
      localStorage,
    );
    return attribute;
  }

  it("paints dark for somebody who chose dark", () => {
    expect(boot("DARK", false)).toBe("dark");
  });

  it("paints light for somebody who chose light on a dark device", () => {
    expect(boot("LIGHT", true)).toBe("light");
  });

  it("follows the device when nothing has been chosen", () => {
    expect(boot(null, true)).toBe("dark");
    expect(boot(null, false)).toBe("light");
  });

  it("does not throw when storage is unavailable", () => {
    // Some privacy modes throw on access rather than returning null, and a
    // themed page is not worth a blank one.
    let attribute: string | null = null;
    const document = {
      documentElement: {
        setAttribute: (_n: string, v: string) => {
          attribute = v;
        },
      },
    };
    const localStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
    };
    expect(() =>
      new Function("document", "window", "localStorage", script)(
        document,
        { matchMedia: () => ({ matches: false }) },
        localStorage,
      ),
    ).not.toThrow();
    expect(attribute).toBe("light");
  });

  it("reads the same key the app writes", () => {
    // These drifting apart would be invisible: the toggle would work for the
    // session and the choice would be forgotten on every reload.
    expect(script).toContain(JSON.stringify(THEME_STORAGE_KEY));
  });

  it("sets the attribute the stylesheet selects on", () => {
    expect(script).toContain("data-theme");
  });
});

describe("the picker", () => {
  it("names every preference", () => {
    for (const preference of Object.values(ThemePreference)) {
      expect(THEME_LABELS[preference]).toBeTruthy();
    }
    expect(THEME_ORDER).toHaveLength(Object.values(ThemePreference).length);
  });
});
