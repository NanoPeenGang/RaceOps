"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { ThemePreference } from "@prisma/client";
import { api } from "@/lib/trpc/client";
import {
  followsDevice,
  parsePreference,
  resolveTheme,
  THEME_STORAGE_KEY,
  type ResolvedTheme,
} from "@/lib/theme";

/**
 * Holds the theme preference and keeps the document in step with it.
 *
 * Two stores, doing two different jobs. **The browser** holds it so the inline
 * boot script can apply it before the first paint — a preference that only
 * lives on the server arrives a frame too late, which is a white flash on a
 * dark-mode phone. **The profile** holds it so the choice follows somebody to
 * a new device, which is the half localStorage cannot do.
 *
 * The browser wins on load. It is the copy that was already applied before
 * React existed, and re-applying the server's answer over it would produce the
 * flash this exists to prevent — so the server copy is only adopted when the
 * device has no opinion of its own yet.
 */

interface ThemeContextValue {
  preference: ThemePreference;
  /** What is actually painted right now. */
  resolved: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function systemPrefersDark(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  /*
   * Starts at SYSTEM on both server and client so the first render matches
   * what was sent, then corrects in an effect. Reading storage during render
   * would produce markup that disagrees with the server's and a hydration
   * error — the document attribute is already right by then regardless, set by
   * the boot script.
   */
  const [preference, setPreferenceState] = useState<ThemePreference>(
    ThemePreference.SYSTEM,
  );
  const [resolved, setResolved] = useState<ResolvedTheme>("light");
  const [loaded, setLoaded] = useState(false);

  const save = api.profile.setTheme.useMutation();

  const apply = useCallback((next: ThemePreference) => {
    const painted = resolveTheme(next, systemPrefersDark());
    document.documentElement.setAttribute("data-theme", painted);
    setResolved(painted);
  }, []);

  useEffect(() => {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    const initial = parsePreference(stored);
    setPreferenceState(initial);
    apply(initial);
    setLoaded(true);
  }, [apply]);

  // The server's copy, adopted only where the device has none — a fresh
  // browser signing in to an account that already chose dark.
  const remote = api.profile.me.useQuery(undefined, {
    meta: { silenceError: true },
  });
  useEffect(() => {
    if (!loaded || !remote.data?.theme) return;
    if (window.localStorage.getItem(THEME_STORAGE_KEY)) return;
    setPreferenceState(remote.data.theme);
    apply(remote.data.theme);
  }, [loaded, remote.data?.theme, apply]);

  /*
   * Repaint when the device flips, but only while following it. Somebody who
   * explicitly chose light does not want their laptop's sunset schedule
   * overruling them at six o'clock.
   */
  useEffect(() => {
    if (!followsDevice(preference)) return;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => apply(ThemePreference.SYSTEM);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [preference, apply]);

  const setPreference = useCallback(
    (next: ThemePreference) => {
      setPreferenceState(next);
      apply(next);
      try {
        window.localStorage.setItem(THEME_STORAGE_KEY, next);
      } catch {
        // Storage is unavailable in some privacy modes. The theme still
        // applies for this session; it just will not be remembered, which is
        // a far better outcome than the click doing nothing.
      }
      // Best effort: a signed-out visitor has no profile to write to, and the
      // choice they just made must not fail because of that.
      save.mutate({ theme: next }, { onError: () => undefined });
    },
    [apply, save],
  );

  const value = useMemo(
    () => ({ preference, resolved, setPreference }),
    [preference, resolved, setPreference],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used inside a ThemeProvider.");
  }
  return context;
}
