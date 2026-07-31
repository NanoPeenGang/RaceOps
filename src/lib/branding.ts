/**
 * Branding: a logo, a banner, and colours that stay readable.
 *
 * Two rules run through this file.
 *
 * Colours are stored exactly as authored and never trusted for contrast. A
 * club picks its colour from a letterhead, not from a palette designed for
 * white text — pale yellow and mid-grey are both real answers, and both make
 * white-on-brand unreadable. So the foreground is *computed*, never stored.
 *
 * Branding inherits: an event falls back to its series, a series to its
 * organization, an organization to RaceOps. A club sets its colours once and
 * every round of every championship picks them up, which is the only version
 * of this feature anyone would actually maintain.
 */

/** RaceOps' own palette, and the floor every fallback lands on. */
export const DEFAULT_THEME = {
  primary: "#D91E1E",
  accent: "#0A0A0A",
} as const;

export interface BrandingInput {
  logoUrl?: string | null;
  bannerUrl?: string | null;
  primaryColor?: string | null;
  accentColor?: string | null;
  tagline?: string | null;
}

export interface ResolvedBranding {
  logoUrl: string | null;
  bannerUrl: string | null;
  tagline: string | null;
  primary: string;
  accent: string;
  /** Readable text on `primary`, computed from its luminance. */
  onPrimary: string;
  onAccent: string;
  /** A faint tint of primary, for section backgrounds and chips. */
  primarySoft: string;
  /** True when nothing was customised, so callers can skip a style tag. */
  isDefault: boolean;
}

/**
 * Resolves branding down a chain, nearest first.
 *
 * Each field resolves independently: an event that sets only a banner keeps
 * its series' colours and logo. Resolving the whole object at the first
 * non-empty layer would mean setting one field silently discarded the rest.
 */
export function resolveBranding(
  ...chain: (BrandingInput | null | undefined)[]
): ResolvedBranding {
  const pick = (key: keyof BrandingInput): string | null => {
    for (const layer of chain) {
      const value = layer?.[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    return null;
  };

  const primary = normalizeHex(pick("primaryColor")) ?? DEFAULT_THEME.primary;
  const accent = normalizeHex(pick("accentColor")) ?? DEFAULT_THEME.accent;

  return {
    logoUrl: pick("logoUrl"),
    bannerUrl: pick("bannerUrl"),
    tagline: pick("tagline"),
    primary,
    accent,
    onPrimary: readableOn(primary),
    onAccent: readableOn(accent),
    primarySoft: mix(primary, "#FFFFFF", 0.9),
    isDefault:
      primary === DEFAULT_THEME.primary && accent === DEFAULT_THEME.accent,
  };
}

/**
 * Accepts `#abc`, `#aabbcc` and bare hex; returns `#AABBCC` or null.
 *
 * Null rather than a fallback so the caller can tell "not set" from "set to
 * something invalid" — the settings form uses that to show a validation
 * message instead of silently reverting to red.
 */
export function normalizeHex(value: string | null | undefined): string | null {
  if (!value) return null;
  const raw = value.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(raw)) {
    return `#${raw
      .split("")
      .map((c) => c + c)
      .join("")
      .toUpperCase()}`;
  }
  if (/^[0-9a-fA-F]{6}$/.test(raw)) return `#${raw.toUpperCase()}`;
  return null;
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export function hexToRgb(hex: string): Rgb {
  const normalized = normalizeHex(hex) ?? DEFAULT_THEME.primary;
  return {
    r: parseInt(normalized.slice(1, 3), 16),
    g: parseInt(normalized.slice(3, 5), 16),
    b: parseInt(normalized.slice(5, 7), 16),
  };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const part = (value: number) =>
    Math.max(0, Math.min(255, Math.round(value)))
      .toString(16)
      .padStart(2, "0");
  return `#${part(r)}${part(g)}${part(b)}`.toUpperCase();
}

/**
 * Relative luminance, per WCAG 2.1.
 *
 * The channel-wise gamma expansion matters: a naive average of R, G and B
 * calls pure yellow dark and pure blue light, which is backwards, and would
 * put white text on yellow — the single most common way brand theming ends up
 * illegible.
 */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const channel = (value: number) => {
    const s = value / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio between two colours, 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const light = Math.max(relativeLuminance(a), relativeLuminance(b));
  const dark = Math.min(relativeLuminance(a), relativeLuminance(b));
  return (light + 0.05) / (dark + 0.05);
}

/** Near-black rather than pure black: softer on a saturated brand colour. */
const DARK_TEXT = "#0A0A0A";
const LIGHT_TEXT = "#FFFFFF";

/**
 * Readable text on a background — whichever of black or white contrasts more.
 *
 * This is why colours are never stored with a foreground: a club changing its
 * red to a pale gold would otherwise keep white text and become unreadable
 * without anyone editing the thing that broke.
 */
export function readableOn(background: string): string {
  return contrastRatio(background, LIGHT_TEXT) >=
    contrastRatio(background, DARK_TEXT)
    ? LIGHT_TEXT
    : DARK_TEXT;
}

/** WCAG AA for normal text. */
export const AA_CONTRAST = 4.5;

/** WCAG AA for large text and for UI borders and icons. */
export const AA_LARGE_CONTRAST = 3;

/** The app's page background — what a brand colour sits *on* as a foreground. */
export const PAGE_BACKGROUND = "#FAFAFA";

/**
 * Warnings about a chosen brand colour.
 *
 * A brand colour is used two ways and they fail in opposite directions. As a
 * fill it carries text, and only a narrow band of mid-greys is too close to
 * both black and white to work — genuinely rare. As a foreground it sits on
 * the near-white page as a link, an icon or a button outline, and *that* is
 * where a pale brand colour disappears entirely.
 *
 * Checking only the first, which is the obvious check, would have passed pale
 * gold as fine while every link rendered in it was invisible.
 *
 * Warnings rather than refusals: it is their brand, and the message says
 * exactly which use is affected so they can decide.
 */
export function contrastWarnings(colour: string): string[] {
  const warnings: string[] = [];

  const onColour = Math.max(
    contrastRatio(colour, LIGHT_TEXT),
    contrastRatio(colour, DARK_TEXT),
  );
  if (onColour < AA_CONTRAST) {
    warnings.push(
      `Text sitting on this colour will be hard to read (${onColour.toFixed(1)}:1, and ${AA_CONTRAST}:1 is the minimum). A darker or lighter shade fixes it.`,
    );
  }

  const againstPage = contrastRatio(colour, PAGE_BACKGROUND);
  if (againstPage < AA_LARGE_CONTRAST) {
    warnings.push(
      `Links, icons and outlines in this colour will be hard to see against the page (${againstPage.toFixed(1)}:1, and ${AA_LARGE_CONTRAST}:1 is the minimum). It will still work as a background behind text.`,
    );
  }

  return warnings;
}

/** The first warning, for a form that shows one line. */
export function contrastWarning(colour: string): string | null {
  return contrastWarnings(colour)[0] ?? null;
}

/** Blends two colours; `weight` is how much of `b` to use. */
export function mix(a: string, b: string, weight: number): string {
  const from = hexToRgb(a);
  const to = hexToRgb(b);
  const w = Math.max(0, Math.min(1, weight));
  return rgbToHex({
    r: from.r + (to.r - from.r) * w,
    g: from.g + (to.g - from.g) * w,
    b: from.b + (to.b - from.b) * w,
  });
}

/**
 * CSS custom properties for a resolved theme.
 *
 * Returned as an object for React's `style` rather than a string of CSS, so
 * a theme is scoped to the element it is set on. A global stylesheet would
 * mean one series' colours leaking onto another's card in a mixed list.
 */
export function themeStyle(
  branding: ResolvedBranding,
): Record<string, string> {
  return {
    "--brand-primary": branding.primary,
    "--brand-on-primary": branding.onPrimary,
    "--brand-primary-soft": branding.primarySoft,
    "--brand-accent": branding.accent,
    "--brand-on-accent": branding.onAccent,
  };
}
