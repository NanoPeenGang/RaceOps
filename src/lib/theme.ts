import { ThemePreference } from "@prisma/client";

/**
 * Light, dark, or whatever the device says.
 *
 * Pure, so the one piece of logic that runs *before React exists* — the inline
 * script that stops the page flashing white — can be tested rather than
 * trusted. Everything here is deliberately free of DOM access; the provider
 * supplies the two facts (what was stored, what the device prefers) and this
 * decides what that means.
 */

export const THEME_STORAGE_KEY = "raceops-theme";

/** What is actually painted, once a preference has been resolved. */
export type ResolvedTheme = "light" | "dark";

export const THEME_LABELS: Record<ThemePreference, string> = {
  SYSTEM: "Match my device",
  LIGHT: "Light",
  DARK: "Dark",
};

/**
 * Reading order in the picker.
 *
 * System first because it is the default and the right answer for most people:
 * somebody who has set their phone to go dark at sunset expects this to follow
 * without being asked again.
 */
export const THEME_ORDER: readonly ThemePreference[] = [
  ThemePreference.SYSTEM,
  ThemePreference.LIGHT,
  ThemePreference.DARK,
];

/**
 * Whatever was in storage, or the safe default.
 *
 * Anything unrecognised falls back to SYSTEM rather than throwing. This runs in
 * a bare inline script before the app loads, where an exception would leave the
 * page unstyled — and a stale or hand-edited value is not worth that.
 */
export function parsePreference(stored: string | null): ThemePreference {
  if (stored === "LIGHT" || stored === "DARK" || stored === "SYSTEM") {
    return stored;
  }
  return ThemePreference.SYSTEM;
}

/** What to actually paint, given the preference and what the device says. */
export function resolveTheme(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): ResolvedTheme {
  if (preference === ThemePreference.LIGHT) return "light";
  if (preference === ThemePreference.DARK) return "dark";
  return systemPrefersDark ? "dark" : "light";
}

/**
 * Whether a change to the device's setting should repaint.
 *
 * Only while following the device. Somebody who has explicitly chosen light
 * does not want their laptop's sunset schedule overruling them at 6pm.
 */
export function followsDevice(preference: ThemePreference): boolean {
  return preference === ThemePreference.SYSTEM;
}

/**
 * The script that runs before first paint.
 *
 * Inlined into the document head and executed synchronously, which is the only
 * way to avoid the white flash: any theme applied after hydration is a theme
 * applied one painted frame too late, and on a dark-mode phone that frame is a
 * face full of white at a night race.
 *
 * Written as a string rather than a module because it has to run before any
 * bundle loads. It is wrapped in try/catch because storage throws outright in
 * some privacy modes, and a themed page is not worth a blank one.
 */
export function themeBootScript(): string {
  return `(function(){try{
var p=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});
if(p!=="LIGHT"&&p!=="DARK"&&p!=="SYSTEM"){p="SYSTEM"}
var d=p==="DARK"||(p==="SYSTEM"&&window.matchMedia("(prefers-color-scheme: dark)").matches);
document.documentElement.setAttribute("data-theme",d?"dark":"light");
}catch(e){document.documentElement.setAttribute("data-theme","light")}})()`;
}
