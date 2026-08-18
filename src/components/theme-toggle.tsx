"use client";

import { ThemePreference } from "@prisma/client";
import { useTheme } from "@/components/theme-provider";
import { THEME_LABELS, THEME_ORDER } from "@/lib/theme";
import { cn } from "@/lib/utils";

/**
 * Picking a theme.
 *
 * Three states rather than a two-way switch. A switch cannot express "follow
 * my device", which is what most people actually want and what somebody who
 * has set their phone to go dark at sunset already assumes is happening — a
 * toggle silently opts them out of it the first time they touch it.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { preference, setPreference } = useTheme();

  return (
    <div className={cn("space-y-1", className)}>
      <p
        className="px-3 pt-1 text-xs font-semibold uppercase tracking-wide text-brand-black/50"
        id="theme-label"
      >
        Appearance
      </p>
      <div
        role="radiogroup"
        aria-labelledby="theme-label"
        className="flex gap-1 px-2 pb-1"
      >
        {THEME_ORDER.map((option) => {
          const active = preference === option;
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setPreference(option)}
              className={cn(
                "flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
                active
                  ? "bg-brand-black text-on-ink"
                  : "text-brand-black/70 hover:bg-brand-black/5",
              )}
            >
              {SHORT_LABELS[option]}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Short forms for the menu.
 *
 * Three buttons across a 224px menu will not hold "Match my device", and a
 * label that truncates is worse than one that is briefer on purpose. The full
 * wording is the accessible name.
 */
const SHORT_LABELS: Record<ThemePreference, string> = {
  SYSTEM: "Auto",
  LIGHT: "Light",
  DARK: "Dark",
};

export { THEME_LABELS };
