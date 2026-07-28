# RaceOps Brand Guidelines

**Logo:** `public/brand/raceops-logo.png` — black "R" mark with a
red-and-black checkered-flag accent, paired with the "RaceOps" wordmark
(black "Race" + red "Ops"). Use as-is: no recoloring, no stretching.

The canonical source export lives at `assets/brand/raceops-logo-source.png`.
`npm run brand:generate` derives every deployed asset from it: the source was
exported with its transparency flattened onto a checkerboard, so the script
restores the transparent background (no recoloring of the artwork), trims
margins, crops the square "R" mark, and renders the favicon and
apple-touch-icon. If the logo is ever updated, replace the source file and
re-run the script.

## Palette

| Token | Hex | Usage |
| --- | --- | --- |
| Primary black | `#0A0A0A` | Wordmark, primary text, dark surfaces |
| Signal red | `#D91E1E` | Accents, CTAs, active states, verified badges |
| Off-white | `#FAFAFA` | Base background |

Exposed to Tailwind as `brand-black`, `brand-red`, `brand-offwhite`
(see `src/app/globals.css`).

## Usage rules

- Logo top-left in the header on every page (`src/components/header.tsx`).
- Favicon derives from the square "R" mark (32/16 px), generated into
  `public/favicon.ico`; `apple-touch-icon.png` at 180px.
- Dark mode: keep the logo as-is (transparent PNG); do not invert.
- Marketing pages: full lockup. Space-constrained app chrome (mobile nav) may
  use `raceops-mark.png` alone.
- Never place the logo on busy photographic backgrounds without a solid-color
  safe area.
