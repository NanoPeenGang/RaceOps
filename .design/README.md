# Design canvas sources

Working files behind the **Paddock Console** mockup — a visual proposal for the
context-first navigation redesign, published as a Claude Design canvas.

Nothing in here ships. It is a design artefact: seven mocked-up screens showing
what the app would look like reorganised around *what you are operating*
(you, a team, a championship, a race weekend) rather than around nouns
(events, series, teams, tracks).

## What is here

| File | Artboard |
| --- | --- |
| `TodayVsProposed.dc.html` | Today's noun-first chrome beside the proposal |
| `Main.dc.html` | Team console — Garage / Invoices |
| `ContextSwitcher.dc.html` | The context switcher, open |
| `RaceWeekend.dc.html` | Race weekend — Race control / Incidents |
| `Explore.dc.html` | One faceted search replacing four directories |
| `CommandPalette.dc.html` | The command palette |
| `Trackside.dc.html` | The phone in the hot pit lane |

`canvas.json` positions them on the canvas and carries the sticky notes.

The `.dc.html` files are **generated**, not hand-written. `_gen.py` holds the
design system — the tokens, and one function per component — read out of
`src/app/globals.css` and `src/components/ui/*` so the mockups use the app's
real values rather than approximations of them. Each `gen_*.py` composes one
artboard from those pieces. Editing a screen means editing its generator and
re-running it; editing the `.dc.html` by hand will be overwritten.

Keeping the design system in one place is the point: when a token or a control
height changes in the app, it changes in `_gen.py` and every artboard follows.

## Rebuilding

```sh
cd .design
python3 gen_main.py            # or any other gen_*.py
```

Then re-seed the canvas. The seeding helper ships with the `design` skill, so
the path below is whatever that skill's base directory is in the session doing
the work:

```sh
node "<skill base>/seed-canvas.mjs" \
  --template "<skill base>/payload.template.html" \
  --out paddock-console.html --title "Paddock Console" \
  --artboard TodayVsProposed.dc.html --artboard Main.dc.html \
  --artboard ContextSwitcher.dc.html --artboard RaceWeekend.dc.html \
  --artboard Explore.dc.html --artboard CommandPalette.dc.html \
  --artboard Trackside.dc.html --canvas canvas.json
```

`paddock-console.html` is the seeded canvas — roughly 2.4 MB, almost all of it
the embedded editor. It is deliberately gitignored: it is build output, and it
is regenerated in full every time.

## Sample data

Every figure on these screens is plausible sample data, not a database read.
The series, tracks, console tabs and navigation labels *are* real — they come
from `prisma/seed-data/`, `src/lib/nav.ts` and the console pages.
