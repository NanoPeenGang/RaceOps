# RaceOps

**The operating platform for motorsport.** One place to run championships,
race weekends and teams, and to find race seats, crew jobs, volunteer shifts
and sponsorship — sim racing and real-world racing as equals, not a pipeline
from one to the other.

Who it is for, and what they do here:

| Audience | What they run |
| --- | --- |
| Series organizers | Calendars, entries, regulations, standings, penalties & appeals |
| Event organizers & race control | Multi-day running orders, live timing, entry lists, volunteer rosters, bulletins |
| Race teams | Roster, schedule, entries, championship position, sponsorship pipeline, team chat |
| Drivers | Race seats across sim and real-world series, one portable record |
| Engineers, mechanics & strategists | Crew roles tagged by what they actually do |
| Marshals, scrutineers & officials | Volunteer shifts with capacity and waitlists |
| Sponsors | Pitch teams directly, track every offer |

## Stack

- **Next.js 15** (App Router) · TypeScript · Tailwind CSS 4
- **tRPC v11** for type-safe client/server contracts · TanStack Query
- **PostgreSQL** via **Prisma** (Neon/Supabase in production)
- **Clerk** authentication (Google + Discord OAuth)
- **Upstash Redis** for rate limiting · **Pusher** for realtime (optional)
- **Stripe** for subscriptions & marketplace fees (Phase 2)
- **Anthropic API** behind a single internal gateway (`/api/ai/*`) —
  `claude-opus-4-8` for high-value reasoning, `claude-sonnet-5` for
  high-volume tasks (Phase 5)
- Vercel deploy · Sentry · PostHog (launch hardening)

## Getting started

```bash
cp .env.example .env    # fill in DATABASE_URL + Clerk keys at minimum
npm install             # also runs `prisma generate`
npm run db:migrate      # apply prisma/migrations to your Postgres
npm run db:seed         # load the reference track directory (idempotent)
npm run dev
```

Optional services degrade gracefully in development: without Upstash env vars
rate limiting is a no-op; without `ANTHROPIC_API_KEY` the AI gateway returns a
configuration error; Stripe/Clerk webhooks respond 500 until their secrets are
set.

## Deploying to Vercel

Import the repo into Vercel, then set these in **Project Settings →
Environment Variables** (all environments):

| Variable | Required | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | ✅ | From the Clerk dashboard (API Keys). Inlined at **build time** — redeploy after changing. |
| `CLERK_SECRET_KEY` | ✅ | Clerk dashboard → API Keys |
| `DATABASE_URL` | ✅ | Neon/Supabase Postgres connection string |
| `CLERK_WEBHOOK_SIGNING_SECRET` | for user sync | Clerk dashboard → Webhooks, endpoint `/api/webhooks/clerk` |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | for rate limiting | No-op without them |
| `ANTHROPIC_API_KEY` | for AI features | Gateway returns 502 without it |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | for billing | Webhook endpoint `/api/webhooks/stripe` (subscribe: `checkout.session.completed`, `customer.subscription.*`) |
| `STRIPE_PRICE_RECRUITER` / `STRIPE_PRICE_SPONSOR` | for billing | Recurring price ids from Stripe → Products |
| `NEXT_PUBLIC_APP_URL` | for billing | Absolute site URL used in Stripe redirects |
| `RESEND_API_KEY` / `RESEND_FROM` | for email | Notification emails; in-app notifications work without them |
| `PUSHER_APP_ID` / `PUSHER_KEY` / `PUSHER_SECRET` / `PUSHER_CLUSTER` | for instant live timing | All four or none; without them boards poll instead |

**Database:** the easiest path is Vercel → your project → **Storage →
Create Database → Neon (Postgres)** — linking it injects `DATABASE_URL`
(and `DATABASE_URL_UNPOOLED`) into the project automatically. Migrations
run during every Vercel build via the `vercel-build` script
(`scripts/migrate-deploy.mjs`, idempotent `prisma migrate deploy` over the
direct connection), which then seeds the reference tracks, so no manual
migration or seeding step is needed. If you bring your
own Postgres instead, set `DATABASE_URL` (runtime, pooled is fine) and
optionally `DIRECT_URL` (migrations).

**If every route returns `500 MIDDLEWARE_INVOCATION_FAILED`**, the Clerk keys
are missing or invalid — the middleware now responds with an explicit 503
message naming the missing variables instead. Set them and redeploy
(`NEXT_PUBLIC_*` values are baked into the build, so a redeploy is required).

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Local dev server |
| `npm run lint` / `npm run typecheck` / `npm test` | CI quality gates |
| `npm run build` | Production build |
| `npm run db:migrate` | Apply migrations (`prisma migrate deploy`) |
| `npm run db:seed` | Load the reference tracks (safe to re-run; see below) |
| `npm run db:studio` | Prisma Studio |
| `npm run brand:generate` | Regenerate brand assets into `public/` |

## Project layout

```
src/
├── app/
│   ├── (marketing)/        # public landing pages
│   ├── (auth)/             # Clerk sign-in / sign-up
│   ├── (dashboard)/        # authenticated app (profile, teams, opportunities, strategy)
│   └── api/
│       ├── trpc/           # tRPC fetch adapter
│       ├── webhooks/       # Clerk + Stripe (signature-verified)
│       └── ai/             # the single Claude gateway (auth + rate limited)
├── server/
│   ├── db/                 # Prisma client singleton
│   ├── trpc/               # context, procedures, per-domain routers
│   └── services/           # AI gateway, rate limiting (iRacing sync: Phase 3)
├── components/             # shared UI (shadcn-style primitives + header)
└── lib/                    # strategy calculators, slug, trpc client, utils

prisma/
├── schema.prisma
├── migrations/             # ordered SQL; see migrations/README.md
├── seed.mts                # `npm run db:seed` entry point
└── seed-data/              # the shipped reference data + the loader
```

### Reference tracks

A directory of real circuits and ovals — two to five per state across the
contiguous United States, road courses and permanent circuits first — so a
fresh deployment is not an empty venue list.

It loads automatically on Vercel: `vercel-build` seeds straight after applying
migrations. Locally, run it once after `npm run db:migrate`:

```bash
npm run db:seed
```

A seeding failure warns but does not fail the build — the app works fine with
an empty track list, and blocking a release over optional reference data would
be the worse outcome.

Each track carries its layouts with length, turn count, direction, banking and
plan shape; its location; and any **facility rules** — sound limits, curfews,
licence requirements — as separate, sourced records rather than prose.

Three operations, and the middle one is what makes a re-run useful rather than
merely harmless:

- **Add** a row that is not there. A venue somebody already added by hand is
  left alone rather than duplicated, matched on name and state — two rows for
  one circuit would split its lap records in half.
- **Fill** a column that is currently null. This is how a *new field* reaches a
  database seeded before that field existed; without it, turn counts and shapes
  would only ever appear on a database seeded from empty, which is nobody's.
- **Overwrite** a column that already holds a value. Never. Correcting a figure
  in `prisma/seed-data/us-tracks.mts` does not propagate to a database where
  somebody has already set that field, and correcting it in the app always wins.

Seeded tracks are marked `isReference` and have no creator. That flips the
curation rule: instead of "only whoever added it may edit it", **anyone signed
in may correct a reference track** and every change is written to the audit
trail. They cannot be deleted. Circuits repave, reconfigure and change sponsor
name, and a shipped list only the maintainers could fix would be wrong within a
season.

The seed files are `.mts` so Node can run them directly by stripping types — no
extra toolchain. `tsconfig.json` sets `allowImportingTsExtensions` for the same
reason: Node's loader needs the real extension on relative imports.

#### Layout diagrams and photographs

Every track carries a gallery — `TrackImage` — rather than one picture slot.
A venue genuinely has several images worth keeping and they are not
interchangeable: the official map, an aerial that shows the elevation a map
flattens, and the paddock plan that tells a transporter which gate to use.
`layoutId` is nullable on purpose: a paddock plan belongs to the facility, not
to one configuration.

Anyone who may correct a track may add photos to it — which on a reference
track means anyone signed in, audited. That is deliberate: the platform will
not draw a road course, so an upload is the only way most circuits here ever
get a picture, and a narrower permission would leave that gap open permanently.

What a layout shows, in order of preference:

1. **A real photo or map**, uploaded from a phone or computer (or linked), with
   a credit line — someone else's diagram needs crediting.
2. **A generated schematic**, for ovals with no photo. An oval's plan shape follows from
   facts a circuit publishes (tri-oval, 33-degree banking, run anticlockwise),
   so drawing it invents nothing; it is the same information the sentence
   carries, arranged so you can take it in at a glance. Labelled *schematic —
   shape and direction only, not to scale*, because a diagram that looks
   surveyed will be read as surveyed.
3. **An invitation to upload one.** This is the answer for every road course
   until somebody supplies a picture. A circuit's outline is survey data — there is no function from
   "4.048 km, 14 turns, clockwise" to the shape of Road America — and a
   plausible squiggle under a real venue's name would be a fabricated map in a
   tool people use to plan race weekends.

#### Facility rules

`TrackRule` is separate from the regulations library because it answers a
different question: not what the series regulates, but what the *venue*
imposes and no club can negotiate away. A sound limit or a Sunday curfew
changes whether you load the trailer at all.

Each rule carries a source and a last-checked date, and the page flags one
nobody has confirmed in over a season. Both exist because an uncited dB figure
from an anonymous edit is not something to plan a weekend around, and because a
stale limit is worse than a missing one. "Never verified" and "verified long
ago" are shown differently — they are different states.

Only three sets of rules ship seeded (Laguna Seca, Lime Rock, Sonoma), because
those are the ones that were actually researched and cited. The rest is for the
people who run there; guessing a sound limit would send somebody home from the
gate with a trailer they did not need to load.

## Build phases

**Phase 1 (done):** auth + onboarding, unified profiles with manual sim
stats, search/discovery with filters, team pages & roster management, CI.

**Profile editing (done):** display name, location, availability, bio and role
tags are all editable from `/profile`; clearing a field stores null rather than
an empty string.

**Role tags (done):** `ProfileType` stays the broad category picked at
onboarding ("I'm an engineer"); underneath it, profiles carry specific role
tags split into **sim** and **real world** — race engineer, data engineer,
strategist, spotter, livery artist, tire technician, scrutineer, timing
official, photographer, sponsorship sales, and so on. The two sets are
separate enums on purpose: `STRATEGIST` on a sim profile and on a real-world
profile are different claims, and the UI labels them as such. Tags are stored
in canonical picker order (deduplicated) so two profiles with the same roles
always read identically, capped at 12 per domain, and are filterable in
discovery via GIN-indexed array containment.

**Phase 2 (done):** opportunities marketplace — posting (individual or team),
application flow with poster-side review and status tracking, Stripe
subscriptions (Recruiter + Sponsor Discovery tiers via Checkout, customer
portal, webhook-synced state), Stripe Connect Express onboarding for
marketplace payouts, and a notification system (in-app + optional Resend
email). Paid gates: posting as a team requires the Recruiter tier; sponsor
search requires Sponsor Discovery.

**Landing pages (done):** series, events and teams each have a public,
server-rendered landing page carrying real `<title>`/OpenGraph metadata, so the
link an organizer posts previews properly and is indexable. The consoles behind
them (`/series/:slug/manage`, `/events/:id/manage`, `/teams/:slug/manage`) stay
behind auth. Anything that depends on who is looking — your entry, your shifts,
chat — mounts as a client island, so the shared HTML is the same for everyone.

**Team management (done):** a console at `/teams/:slug/manage` to run a race
team from one page.

- **Roster** — drivers and staff split out, with roles (owner, manager, driver,
  engineer, crew, member) driving access. Managers change roles and take people
  off the books; removal closes the membership out rather than deleting it, so
  past line-ups stay on the record. A team can never be left without an owner.
- **Schedule & entries** — the team's calendar built from its entries, split
  into what is coming and what has run, with withdraw in place.
- **Standings & results** — championship position in every series the team
  races in, plus every result. Points come from the series' own standings table
  rather than being recalculated, so a stewards' deduction shows up here and an
  overturned penalty restores it automatically.
- **Sponsorship** — offers and active deals. A sponsor pitches through the
  platform and it lands as an offer the team accepts, negotiates or declines;
  managers can also record deals agreed offline. Deal value is stored in minor
  units and totalled per currency, never summed across them. Commercial terms
  are visible to the team only.
- **Team chat** — the team's own room, separate from event paddock chat.

**Race weekend regulation (done):** the operational layer a real championship
needs beyond a calendar.

- **Endurance line-ups** — an entry declares a crew (driver of record, drivers,
  reserves) with a stint log. Drive-time regulations are per event and all
  optional, so a sprint round enforces nothing while an endurance round can cap
  stint length and total drive time per driver. Compliance is checked per driver
  across the whole event, open stints are measured live so race control sees a
  car approaching a limit, and an unmet minimum stays "outstanding" rather than
  a breach until the event is over.
- **Multi-class championships** — classes are records a series creates with
  free-form names, so a pro grid declaring GT3 and GT4 and a club autocross
  region declaring thirty local classes both work. Each class gets its own
  table and may set its own points scale. Alongside them: drivers' and teams'
  championships from the same results, dropped scores ("best 8 of 10"),
  per-round weighting for a double-points finale, and a minimum-starts rule for
  title eligibility.
- **Entry eligibility** — series define what a driver must hold: a credential,
  a sim rating floor, a minimum age, or a sign-off the platform cannot verify.
  Requirements are scoped series-wide or to one class and checked per declared
  driver; blocking ones stop confirmation naming the driver and the rule, and an
  organizer can sign off or refuse anything explicitly.
- **Scrutineering** — a series writes a card of checks once; opening it for a
  car copies the items so a later template edit never rewrites history.
  Measured checks pass or fail on the number against their tolerance, a card
  only settles once every check is worked through, and failures turn into a
  penalty citing what failed. Re-checks supersede the failure that prompted
  them.
- **Incidents & stewarding** — the front half of stewarding, which was missing:
  competitors, marshal posts and race control file reports with a lap and a
  corner, and officials triage the queue from noted through to a decision.
  Protests carry a right of reply and sort to the front. Open investigations
  stay private to the parties and the officials; decisions are published.

**Race weekend infrastructure (done):** the paperwork and equipment records a
meeting actually runs on.

- **Tracks** — a venue is a record rather than free text, with named layouts
  (Spa GP vs. Endurance), numbered and named corners, timing sectors, pit box
  count and a free-form licence grade. Tracks are shared reference data curated
  by whoever added them; one with event history cannot be deleted. This is what
  lets an incident point at "Turn 2 (Eau Rouge)" and carry the marshal post
  covering it, and what makes **lap records** possible: computed per layout,
  overall and per class, from the timing board rather than kept by hand.
  Re-saving a layout's corners updates them in place, so renumbering around a
  new chicane never detaches the reports that reference them. The directory
  ships populated — see [Reference tracks](#reference-tracks) — and filters by
  country and state, because somebody looking for a venue near them thinks in
  states, not in spellings.

  **Events pick their venue from that directory.** The track picker appears
  where the event is created, not only on a separate page afterwards, because
  a venue typed as free text links to nothing: no map, no corner references, no
  lap records. Free text is still accepted and always will be — a hillclimb on
  someone's estate has no `Track` row and does not need one — it just is not
  the default any more. The event page then shows the layout being run with its
  map and figures, and lists the circuit's *other* configurations beside it, so
  "Full Course" reads as one of four rather than as an unexplained label and
  nobody arrives having practised the wrong one. A track that has hosted an
  event cannot be deleted, and a layout that has cannot either — mark it
  inactive, which hides it from the picker without detaching the results.
- **Session conditions** — track state and weather logged as a time series, not
  a pair of fields: a two-hour race that starts dry and ends in standing water
  is the normal case. Track state is separate from weather because they diverge
  (a track is damp under a clear sky an hour after rain), and `DAMP` counts as
  wet for regulation purposes since a damp track has no dry line. A session with
  no readings stays unknown rather than dry, so laps set before conditions were
  captured are not thrown out.
- **Cars & transponders** — a `Car` carries chassis, engine and homologation and
  keeps its own race history, so results follow the chassis as well as the team.
  Transponder numbers are normalized on the way in, because a timing feed
  writing "TR-1 234 567" has to resolve to the unit registered as "1234567";
  a unit already fitted to another entry at the same event is refused.
- **Tire allocation** — sets are records rather than a counter, so an allocation
  can be audited: a mis-scanned set is voided, not deleted, and stops counting
  against the allowance while staying visible.
- **Paddock & credentials** — garage, pit box, paddock space and transporter
  bay per entry, with clashes reported rather than refused (an organizer moving
  four entries around passes through clashing states). Passes are named, not
  counted, because that is what accreditation needs at the gate; teams name
  their own crew and officials issue, collect and void.
- **Officials' log & audit trail** — flag changes, session states, penalties
  and stewards' decisions write themselves to a chronological log as they
  happen, publishable as the end-of-meeting bulletin. Separately, an
  append-only audit trail records who changed a result or amended a penalty and
  what it used to say — once a championship has consequences, "the database
  says so now" is not an answer. Reading the audit trail is owner/admin only,
  deliberately excluding race control.
- **Generated documents** — the entry list, timetable, grid sheet and timing
  sheet are built from the data already held and printed from the browser, with
  a print stylesheet. Car numbers sort numerically ("7" before "11"), cars with
  no qualifying time still appear at the back of the grid, and grids form up
  two abreast or wider. Nothing is stored, so a document cannot go stale the way
  an uploaded PDF does the moment somebody withdraws.
- **Waivers & e-signature** — per-event or series-wide, with the wording
  versioned rather than edited: a signature only means something against the
  exact text shown, so changing it reissues the waiver and earlier signatures
  stop covering it. What makes the typed-name signature hold up is the record
  around it — version, time, client address, user agent. Required waivers gate
  confirmation, and unlike an entry requirement an organizer cannot waive one.
- **Broadcast** — a stream-overlay JSON feed per session for an OBS browser
  source, with every value pre-formatted, plus a commentator pack: the entry
  list with championship position, gap to the leader, season record and whether
  the title is still mathematically available.
- **Trackside offline mode** — an outbox queues writes when there is no signal
  and sends them when there is, surviving a locked or reloaded phone. Only
  observations can be queued (a marshal's report is still true an hour later;
  a penalty replayed from a stale queue could land after the stewards already
  ruled), and everything else fails loudly offline so the person knows.

**Organizations, staff roles & branding (done):**

- **Organizations** — the club, promoter or company behind a series or team.
  Entirely optional: a one-person league never creates one, and series and
  teams work standalone. Reach for it when several people share the work, or
  when one body runs several series and wants one staff list across them.
- **Custom staff roles** — a role is a named bundle of granular permissions,
  so a club with a "Chief Scrutineer" and a "Media Officer" can say so instead
  of picking the nearest of five fixed roles. Roles live on an organization or
  on a single series. Two guards close the obvious holes: nobody may grant a
  permission they do not hold themselves (otherwise staff management is a
  two-click path to everything), and deleting a series or organization and
  minting an owner check the built-in OWNER role only — those are ownership
  acts, not delegable capabilities. Permissions are checked one at a time and
  never derived from "an admin can do this too", which is exactly how a narrow
  role escalates.
- **Branding** — logo, banner, tagline and two colours per organization,
  series, event or team, each field inheriting independently down the chain.
  Colours are stored as authored and the readable foreground is computed from
  WCAG luminance, so a club picking pale gold from a letterhead does not get
  white text. The editor warns about both failure modes — a colour text cannot
  sit on, and a colour that vanishes as a link against the page — and refuses
  neither, because it is their brand.
- **Direct uploads** — profile pictures, logos, banners and event media upload
  from a phone camera or a computer. Images are downscaled in the browser
  first and the bytes go straight to object storage on a presigned PUT, so a
  6 MB camera JPEG does not travel over circuit wifi at full size. Content
  type is a signed header and object keys are server-generated; SVG is never
  accepted. Where no bucket is configured the UI falls back to attach-by-URL.
- **A signed-in dashboard** — `/home` replaces the marketing page after login,
  ordered by what needs you: anything live or blocking, then your next race.
  Someone with nothing set up gets a first-run screen with three routes rather
  than a wall of empty cards.
- **Consoles reorganised** — the event console was eighteen stacked panels and
  is now seven tabs grouped by when you use them; the series console is five.
  Tab state lives in the URL so a reload lands back where you were and a
  screen can be linked to. Shared `PageHeader` / `Section` / `EmptyState`
  primitives replaced the per-page markup each screen had invented.

**Race organizer module (done):** run a whole championship from one place.
Create a **Series** (organizer roster with OWNER / ADMIN / RACE_CONTROL /
VOLUNTEER_COORDINATOR roles), schedule **events** through a
draft → published → completed lifecycle, take **team or individual entries**
with a registration window, entry capacity, unique car numbers and automatic
waitlisting, and staff **volunteer shifts** (marshal, flag, timing,
scrutineering, medical, …) with per-shift capacity and its own waitlist.
Freeing a confirmed slot — an entrant withdrawing, an organizer rejecting —
automatically promotes the longest-waiting entry and notifies them. The
series dashboard aggregates entries and volunteer coverage across the
calendar.

**Championship, stewarding & media (done):**

- **Standings** — a points leaderboard per series, scored from completed
  rounds with a configurable points scheme (FIA-style top-10 by default) plus
  an optional fastest-lap bonus. Ties break on wins, then podiums, then best
  finish.
- **Penalties** — race control and stewards log decisions against an entry
  (time, drive-through, stop & go, grid drop, points deduction, DSQ, warning,
  fine) with the regulation cited and the lap number. Points deductions flow
  straight into the standings.
- **Appeals** — the competitor named in the entry (or their team's
  owner/manager) files an appeal, which moves the penalty to *under appeal*.
  Stewards rule: rejecting upholds the penalty, upholding either overturns it
  or reduces it to a lesser sanction. Overturning restores the championship
  points automatically. `RACE_CONTROL` is deliberately excluded from the
  appeal panel so the officials who issue penalties are not the ones who hear
  the challenge.
- **Public record** — every penalty, its appeal and the steward's reasoning
  appear on the competitor's series profile and the event's penalty page.
- **Media** — attach images, video, telemetry or documents to a series,
  event, team, penalty (evidence) or appeal. Penalty evidence is race
  control's to manage; appeal evidence belongs to the competitor who filed.
  Items can be marked organizers-only to keep them off the public record.

> Media is registered by URL — upload to Cloudflare Images / R2 / S3 and
> attach the delivered URL. Direct browser upload lands once object-storage
> credentials are configured.

**Bulk results import (done):** organizers paste or upload a CSV/TSV or JSON
export from their timing system instead of typing each classification.
Entries are matched on car number, falling back to competitor name; the
import is previewed as a dry run first, and ambiguous or duplicated matches
block the write rather than risk classifying the wrong competitor. Re-running
an import updates existing results, so corrections are a re-upload. Imported
results feed the championship standings immediately.

**Phase 4 — race weekend operations (done):**

- **Multi-day schedules** — an event is a list of sessions (scrutineering,
  practice, qualifying, race, briefings, support races, media), each with its
  own start/end and location. The organizer view groups them into days and
  warns about overlaps rather than blocking them, since support paddocks run
  activities in parallel on purpose. Entrants read the running order without
  signing in.
- **Live timing** — every session carries a timing board and a flag state
  (green / yellow / safety car / VSC / red / checkered). Race control seeds the
  board from the confirmed entry list, then posts positions, laps and lap times
  from the console; a personal best is only lowered when the new lap is
  actually quicker. The public board is polled while a session is live and
  shows gaps, laps down and the session's fastest lap. A **Live now** strip on
  the events page links straight into whatever is running.
- **Regulations library** — rule books, supplementary regulations, technical
  sheets, race-control bulletins, entry lists and approved media kits attach to
  a series for the season or to a single event. Each item carries a revision
  label and can be superseded by a newer one, which keeps the old file
  readable but visibly retired. Visibility is public, entrants-only or
  organizers-only.
- **Notices** — organizers post announcements (info / important / urgent,
  optionally pinned) and can push them to everyone entered as notifications.
- **Race reports** — long-form post-race writeups with tags, an optional link
  to the event, and their own media gallery. Drafts stay private to the author
  until published.
- **Accreditation** — pass types carry the **areas they open** (paddock, pit
  lane, grid, race control, media centre…) rather than a numeric "level":
  access is not a ladder, and a photographer belongs trackside but not in race
  control while a team owner is the other way round. Set a type's audience —
  drivers, entrants, volunteers, organizers — and **one button names everyone
  and issues their pass**, sweeping the confirmed entries' line-ups, the
  volunteer signups and the series' officials. The sweep previews first and,
  more importantly, lists anyone who matches *no* configured type: that is the
  driver who would otherwise turn up on Saturday with nothing and appear in no
  error message. Re-running it issues nobody a second pass, and a voided pass
  is re-issued rather than skipped.

  Every issued pass gets an unguessable QR code and prints onto a badge sheet.
  Scanning it opens `/pass/<token>` — public, because the person scanning is a
  marshal on a gate at 07:00 with a phone and no reason to hold an account —
  which shows the verdict first, then the holder's name, team and car number,
  role, and the areas they may enter. A lost badge's code is rotated in place,
  which kills it instantly without discarding the pass's history. Only issued
  passes print: a requested one on a lanyard scans as "do not admit" while
  looking exactly like a working badge.
- **Paddock chat** — a per-event room for entrants, volunteers and organizers.
  Authors delete their own messages; organizers moderate the room.

> Realtime is optional. With Pusher credentials set, boards and chat update
> instantly; without them everything polls and still works.

**Phase 3 (in progress):** Pit Wall strategy plans now persist against an
event and can be shared with a team (author-only edit, team read). Remaining:
iRacing auto-sync (blocked on partner API approval) and the verified-badge
pipeline. The CSV/JSON import above is the shipped stopgap.

**Phases 5–6** (AI layer, launch hardening) are scaffolded where
cross-cutting: the AI gateway exists with the production security posture.
Discord guild sync is deferred until OAuth credentials are available.

### Integration tests

Router-level tests run against a real Postgres and are opt-in, so CI (which
has no database) stays green:

```bash
createdb raceops_test
DATABASE_URL="postgresql://…/raceops_test" npx prisma migrate deploy
RUN_DB_TESTS=1 DATABASE_URL="postgresql://…/raceops_test" npx vitest run tests/integration
```

> **iRacing API access requires partner approval — apply in Week 1.** Until
> approved, sim stats are manual entry (already supported) with CSV import as
> the Phase 3 stopgap.

## Brand

See `docs/BRAND.md`. All deployed assets in `public/` are derived from the
canonical logo (`assets/brand/raceops-logo-source.png`) via
`npm run brand:generate`.

## Security posture

- All secrets via environment variables; only `.env.example` is committed.
- Stripe & Clerk webhooks verify signatures before processing.
- Every mutating tRPC procedure scopes writes by the authenticated user
  (row-level authorization); client-supplied ids are never trusted alone.
- AI endpoints are authenticated and rate limited (cost control).
- GDPR/CCPA: `user.exportData` and `user.deleteAccount` procedures; Clerk
  `user.deleted` webhook cascades local deletion.
