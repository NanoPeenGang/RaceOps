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
npm run db:seed         # load the reference tracks and series (idempotent)
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
| `PLATFORM_OWNER_EMAIL` | optional | Overrides the owner address baked into `src/server/services/platform-admin.ts`. Only needed to hand the platform over or to run a staging copy under a different account. |
| `PLATFORM_ADMIN_EMAILS` | optional | Further comma-separated sign-in addresses granted platform admin regardless of the database column, alongside the owner. |
| `RESEND_API_KEY` / `RESEND_FROM` | for email | Notification emails; in-app notifications work without them |
| `PUSHER_APP_ID` / `PUSHER_KEY` / `PUSHER_SECRET` / `PUSHER_CLUSTER` | for instant live timing | All four or none; without them boards poll instead |
| `APPLE_WALLET_PASS_TYPE_ID` / `APPLE_WALLET_TEAM_ID` / `APPLE_WALLET_SIGNER_CERT` / `APPLE_WALLET_SIGNER_KEY` / `APPLE_WALLET_WWDR_CERT` | for Apple Wallet passes | All five or none; without them the Wallet button is hidden and passes are shown on screen and printed instead. Certificates are PEM; the signer key mints passes under your Apple identity, so treat it as a secret. |

**Database:** the easiest path is Vercel → your project → **Storage →
Create Database → Neon (Postgres)** — linking it injects `DATABASE_URL`
(and `DATABASE_URL_UNPOOLED`) into the project automatically. Migrations
run during every Vercel build via the `vercel-build` script
(`scripts/migrate-deploy.mjs`, idempotent `prisma migrate deploy` over the
direct connection), which then seeds the reference data, so no manual
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
| `npm run db:seed` | Load the reference tracks and series (safe to re-run; see below) |
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

### Reference series

The same idea one level up: a shipped championship, so a driver can look up
when and where a series runs — and what it will demand of a car and a crew —
before they have any account relationship with it. The **ChampCar Endurance
Series** ships seeded (`prisma/seed-data/champcar.mts`): the published 2026
calendar, each round linked to a circuit in the track directory, and a cited
summary of the rule book.

It follows the same add / fill / never-overwrite contract as the tracks, with
one deliberate difference in the curation rule. A reference *track* is editable
by anyone signed in, because a circuit's length is a fact and whoever spots a
typo should be able to fix it. A reference *series* is not: a championship's
calendar and regulations are its organizer's to state, and a wiki-editable rule
book would be worse than no rule book. These change by re-seeding.

A seeded series has **no organizers**, which is not an oversight — it is the
mechanism. Every organizer-only mutation already refuses a series the caller
has no role in, so a reference copy is read-only everywhere without a single
special case, and the page says so rather than leaving people hunting for an
entry button. A slug held by a series somebody is actually running is skipped
outright: overwriting a live season's calendar with a copy of a published
schedule is the worst thing this script could do.

Rounds are matched on **name and date**, not name alone — the 2026 season
visits both Sebring and Harris Hill twice, and matching on name would silently
drop the second visit.

#### Which configuration a round runs on

A circuit's *primary* layout is not the one a given series races. Autobahn's
primary is the full course and ChampCar runs the south; Daytona's is the
tri-oval, which no 14-hour road race uses. So the calendar names the
configuration, and the loader has three states rather than a guess:

- **Named** — the schedule or the series' own entry pages say which course it
  is. Link it. If that name is not in the directory the round is left
  *unlinked*, because a typo should surface as a missing map rather than hide
  behind a plausible-looking one.
- **Omitted** — the configuration is not published. Link the circuit's primary
  layout so the round still carries a map and a length, and write a line on the
  event saying the configuration is unconfirmed. Unmarked, a fallback is
  indistinguishable from a sourced fact.
- **Null** — the series races a configuration the directory does not carry
  (Pocono runs one of half a dozen infield courses, and the directory has only
  the tri-oval). Link nothing; the free-text venue is the honest answer.

Three ship today, and they are deliberately different shapes:

- **ChampCar Endurance Series** — the published 2026 calendar plus a cited
  summary of the BCCR.
- **American Endurance Racing** — the rounds that could be corroborated, and a
  note on the series saying the list may be short. AER's format is unusual
  enough to be worth carrying: classes are set from Friday's lap times rather
  than from a build rule book, the minimum stop count falls out of the race
  length, and the eligibility rule is "bring the car you already race with
  somebody else" rather than a spec of its own.
- **24 Hours of Lemons** — the rule book only. Its schedule could not be
  verified when the entry was written, and Lemons runs over twenty rounds a
  season; two corroborated rounds would be read as the season, which is worse
  than none. A series with rules and no calendar is a supported shape, not a
  broken one — the $500 rule is worth having on its own, and rounds can be
  added the moment somebody can source them.

Where a round's circuit configuration is not stated by the organizer, the event
links the venue's primary layout and *says on the event* that it did. Unmarked,
a fallback is indistinguishable from a sourced fact, and somebody tows to the
wrong paddock.

`SeriesRule` is the sporting counterpart to `TrackRule` and carries the same
citation and last-checked date, for the same reason. What is seeded is a
summary and says so **first**, above the regulations it qualifies — a "read the
actual rule book" note printed under seven rules somebody has already acted on
is not a caveat. No fee, deadline or scrutineering figure is seeded: those
change between events and between revisions, and a stale one costs somebody a
build.

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

**The team console (done):** seven tabs — Roster, Hiring, Money, Garage,
Racing, Comms, Settings — rather than a dozen panels down one page. Tab state
lives in the query string, so a reload lands you back where you were and "look
at the payroll screen" is a link somebody can send. Only the active tab is
mounted, so opening the console no longer fires every panel's queries at once.

Grouping follows the job somebody sat down to do rather than which table the
data lives in: seat time is a roster question even though it is built from
stints, and sponsors are money even though they are nothing like payroll.

**What needs you (done):** the platform now records a great deal, and the
failure mode has stopped being "we cannot track this" and become "nobody
noticed" — an application unanswered for three weeks, a rebuild that went
overdue in February, a pay run approved and never paid. Each is visible on its
own panel and nowhere else, which means it is invisible.

`lib/attention.ts` is the one shape that answers it, and it drives both the
badges on the console tabs and the strip on the home dashboard, so a badge can
never disagree with the page it points at. Every chip links into the tab that
fixes it rather than dropping somebody at the top of a long console.

- **Urgent is reserved** for things already wrong: money owed and unpaid, a car
  overdue, somebody waiting over a week. Everything else is a prompt. Marking
  everything urgent is the same as marking nothing.
- **Zeros are dropped**, not shown as "0 overdue". A list of things that are
  fine is not a to-do list, and reading one teaches people to skip the strip.
- **Counts are things to do, not row totals.** Twelve low-stock parts is one
  trip to the shop; six unpaid lines on one run is one payment to make.
- **Null, not zero, for people who cannot see it.** A driver opening the
  console gets no badges — "nothing needs attention" and "you are not allowed
  to know" are different answers, and returning the second as the first would
  quietly tell them the team has no outstanding pay runs.
- Computed for every team somebody manages in **six queries regardless of how
  many teams that is**, with a test that fails if it ever becomes a loop.

**Hiring (done):** posting to hired, without leaving the console.

Applications land in a team-scoped **inbox** rather than sitting under whichever
advert they came through — a team does not think in postings, it thinks in
people waiting on an answer. The inbox is a pipeline (new → in review →
interviewing → offer out) with the person who has been waiting longest at the
top of each column, because they are the one the team owes a reply and a
newest-first list buries them under every arrival since. Applications are
flagged stale after a week, measured from when they applied and *not* from the
last time somebody nudged the status — moving a row from "new" to "in review"
without answering anybody is not progress, and resetting the clock for it would
hide exactly what the number exists to surface.

**Interviews** are proposed at several times at once, and the applicant picks
one. That is the whole feature: one suggested slot becomes an email thread, and
four days later the seat is gone. Times are stored in UTC and rendered in
whoever is looking at them's own zone — a team in Charlotte interviewing a
driver in Munich is the ordinary case, and a naive local time puts somebody on
a call at 3am. A `TRACK_TEST` and a `WORK_TRIAL` are first-class kinds, because
for a seat and for crew respectively that *is* the interview. The team's
private notes are a separate field from the agenda the applicant sees.

**Offers** carry the role, the terms and the money, and the applicant answers
them. Accepting is what puts somebody on the roster at the offered role **and**
sets their standing pay rate — hiring somebody and then separately typing them
into the roster and again into the pay rates is where the details drift apart,
and that single step is the reason an offer is a record rather than a message.
A team that just wants to say yes can still do that: `ACCEPTED` is reachable
directly, because most club hiring is a conversation and a handshake, and
forcing everyone through the paperwork makes it something people work around.

Two rules the money side follows everywhere:

- **Unpaid is a basis, not a zero.** Most club crew are volunteers and a great
  many seats are paid by the driver, so a form that insists on a number gets 0
  typed into a field the payroll then treats as a wage — and a payroll built on
  that pays people nothing while looking entirely correct. `UNPAID` with a null
  amount, `PER_EVENT` with a null amount ("rate to be agreed") and
  `PER_EVENT` with 0 are three different statements, and the UI says all three
  differently.
- **Only the applicant declines an offer.** A team can reject an application,
  but `OFFER_DECLINED` is not theirs to set — that would be writing somebody
  else's answer down. It is kept apart from `WITHDRAWN` because a refused offer
  is a different fact, and worth knowing when the next one is written.

Closing the posting after a hire is offered, never automatic: a team hiring two
mechanics off one advert would be furious to find it closed after the first,
and nothing can know how many seats a posting is for.

**Payroll (done):** what the team owes, and what it has paid.

> **This is not a payroll processor.** Nothing in it withholds tax, files a
> return, or moves money. It works out what is owed, records what was paid, and
> exports the figures for whoever actually runs the payroll — an accountant, a
> bureau, or a bank transfer. That limit is on the panel itself, not in a
> tooltip: a team believing otherwise on the platform's word would be making a
> genuinely costly mistake, and burying the caveat would make that the
> platform's fault rather than theirs.

- **Standing rates** per person, superseded rather than overwritten. A run
  built for March has to keep making sense in December, and it cannot if the
  rate behind it was quietly rewritten — so setting a new rate closes the old
  one out and `rateOn(date)` answers with whichever was in force.
- **Pay runs** start pre-filled from those rates at quantity 1, so a monthly
  run is a few counts confirmed rather than the roster retyped. People with no
  rate, and volunteers, are left off entirely: a zero-value row per volunteer
  buries the people actually owed money.
- **Approval freezes the figures.** After it, only payment marks change. That
  is the whole point of the step — money should not go out against a number
  that can still be edited behind it. A paid line cannot be deleted and a paid
  run cannot be cancelled.
- **Currencies are never added together.** A team paying a driver in euros and
  a mechanic in dollars has two numbers; one combined figure would be a
  made-up amount in a made-up currency on a document somebody pays people from.
- **Everything is integer minor units.** Money as a float is a rounding bug
  that pays somebody a penny less every month and is found in an audit two
  years later. The one deliberate exception is the CSV export, which writes
  major units because that is what a bank file and an accountant read — one
  conversion, on the way out.
- **Payees without accounts** are first-class. The mechanic who does two
  weekends a year has no login, and excluding them pushes a chunk of a real
  team's costs back onto the spreadsheet this replaces. A line has exactly one
  payee — an account or a name, never both.
- **CSV export** quotes any cell containing a comma or a quote, and prefixes
  anything starting `=`, `+`, `-` or `@` with an apostrophe. A payee name is
  attacker-controlled text on a file an accountant opens in Excel, where such a
  cell is executed.

**The garage (done):** the records a team keeps between events, on the same
console.

Reading the garage is for the whole roster — a driver should be able to find
the setup they ran last time without asking anyone. Writing is for the people
who run the car: managers, engineers and crew. That is not a slight on
drivers; it is that a part marked consumed from the paddock is how a count
stops matching the shelf.

- **Parts & stock** — a ledger, not a counter. Every change is a movement with
  a signed delta and the balance it produced, and the item's quantity is a
  cache of the latest balance. There is deliberately no path that edits a count
  directly: that costs a row per change and buys the question a trailer
  inventory is actually asked, which is never "how many pads do we have" but
  "who took the last set, and was it at Sebring or at the shop". Stock cannot
  go negative — a team that finds it "should" have has a missing receipt, not a
  negative shelf. The reorder list leads the panel, because it is the part
  somebody has to act on before Thursday.
- **Telemetry & setups** — one model for both, because they share every
  question worth asking (which car, which circuit, which session, whose lap,
  how quick) and differ only in what opens them. Nothing here parses a file: a
  MoTeC `.ld` and an iRacing `.sto` are opaque binaries, and claiming to read a
  lap time out of one would put a guess next to a real number. The lap time is
  typed, and it is what makes a setup findable in six months — "the quickest we
  have been here" is the reason to reopen one.
- **Car services** — what was done, and what is due. An interval can be a date
  (an annual logbook inspection) or running hours (a gearbox rebuild), and both
  are honoured; whichever arrives first is what the console warns about. An
  hours-based interval on a car with no hours recorded reports as *unknown*,
  never as fine — the interval exists, we just cannot say where the car is
  against it, and pretending otherwise is how a rebuild gets missed. Deferring
  a job stops it nagging without deleting it.
- **Seat time** — time in the car per driver across every event the team has
  entered. The event line-up panel answers "is this entry legal"; this answers
  the question asked *between* events, which nothing else could: who is owed a
  run. Drivers with no stints at all are listed by name, because they are
  invisible in a table built from stints and they are the whole point. Minutes
  from stints whose driver has since left a line-up are reported separately —
  they happened and belong in the team's hours, but attributing them to
  somebody would be a guess.

**Pit stop planning (done):** a stop plan per entry, on the team console and on
the event page.

Planned against the entry rather than the car, because the plan belongs to the
weekend — the same car in two events has two independent sequences. Both a
target lap and a target time are optional: a sprint plans by lap, an enduro by
the clock, and a wet race by neither until the radio says so.

The plan and the log are the same rows, because the useful comparison is "we
said 32 seconds and it took 51", and keeping intention and outcome in two
tables means nobody ever lines them up.

The whole active roster can write it, not just managers: a plan is edited in a
pit box by whoever has a free hand, and a rule that only the manager may move a
stop means the plan stops being updated exactly when it matters most. Race
control can *read* it — that is how a driver-change regulation gets checked
before it is breached rather than after — and cannot change it, because a
team's strategy is theirs.

The planner states the problems a plan has rather than blocking a save: a
half-built plan is the normal state at 9am on a Saturday. The one it exists for
is the handover chain — a stop that takes out a driver who was not in the car
reads fine row by row and cannot be driven, and it is exactly the error a tired
crew chief makes reshuffling a rotation at midnight. A completed stop cannot be
deleted; it is why the fuel numbers add up.

**Department channels & direct messages (done):** two more kinds of room, on
the same `ChatMessage` table as event paddock chat and team chat. A message
belongs to exactly one of the four; a CHECK constraint enforces it.

**Department channels** are rooms narrower than their scope — the engineers,
the crew, race control. The rule that makes them worth having is that
**membership is derived, never stored**: you are in the engineers' channel
while you hold that role, and you are out of it the moment you do not. A stored
member list would leave a departed engineer reading the engineers' channel
until somebody remembered to prune it, which is precisely the failure a private
channel exists to prevent.

A channel hangs off exactly one team, event, series or organization, and the
scope decides which role list applies. On an *event* channel there are two
genuinely different things to make, which is what the `includesEntrantTeams`
switch is for:

- off — the officials' room: the series' own staff, by series role.
- on — the paddock-wide department room: every engineer entered in the meeting,
  from every team. Nothing else on the platform can put those people in one
  place.

Only whoever runs the scope can create a channel, and they can always read and
moderate one — somebody has to be able to clean up a room they are not a member
of, and there is no other candidate. That person is *not* counted as one of the
department: a manager reading the crew channel is not the crew, and a member
list that says otherwise is lying about who is in the room.

The channel list shows only what the viewer can actually enter. That is not
politeness — a list of four channels you cannot open tells everyone what
departments exist and roughly who is in them, which is information a private
channel is supposed to be keeping.

There is no delete, only archive. A department channel is where decisions get
made — what fuel number was agreed, who called the driver in — and deleting it
destroys that for everyone at once. An archived channel stays fully readable
and stops accepting posts; the archived check lives on the write path only,
because an archived room you cannot read is a delete with extra steps.

**Direct messages** are the one room with no organizational scope, which is
exactly why they are wanted: an engineer who needs a word with a driver on
another team has nowhere else to have it, and routing that through a team
channel makes it everyone's business.

- A two-person thread carries a `pairKey` — the two user ids sorted and joined
  — so "message this person" from three different pages lands in one thread
  rather than three, each holding part of the conversation. Group threads leave
  it null, because three colleagues can reasonably want two different group
  conversations.
- Asking for a thread you are not in returns **not found**, not forbidden.
  Whether two other people are talking is itself private, and forbidden would
  confirm it.
- A thread has no moderator. There is no organization above a private
  conversation, so nobody has standing to delete somebody else's words in one;
  authors still delete their own.
- Leaving hides a thread rather than destroying it — the other side's copy is
  not the leaver's to delete — and a later message brings it back, because a
  reply to a conversation you left is still addressed to you.
- Direct messages post through `message.send`, never `chat.send`. A thread
  message has bookkeeping a room message does not (bumping the inbox order,
  clearing the sender's own unread mark, notifying the other side), and a
  second write path that skipped it would produce threads that never surface in
  anyone's inbox. `chat.send` refuses a thread scope loudly rather than
  duplicating that bookkeeping somewhere it can drift.

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

  **Gate control.** `/events/:id/gate` is the internal side: a marshal picks
  the area their gate controls, names it, and scans. The camera runs
  continuously through `BarcodeDetector` where it exists and jsQR everywhere
  else — Safari has no `BarcodeDetector` and the people standing on gates are
  overwhelmingly holding iPhones — with a manual box for a wet lens or a
  scratched lanyard sleeve.

  The verdict is the whole screen and answers *this gate's* question rather
  than "is this real": a competitor pass at race control reads **wrong gate**
  in amber, not "valid", because telling a marshal "valid" while they stand on
  the pit wall is how the wrong people get in. A pass issued for a different
  event reads as unknown rather than as a valid pass in the wrong place — last
  month's badge is the most obvious way a gate gets walked through.

  Every scan is recorded, refusals included: those are the ones anybody asks
  about afterwards, and the log is the only account of who was inside the
  fence when something happened. Repeat reads of the same badge within a few
  seconds are suppressed so a camera reading eight times a second does not
  turn the head count into noise.

  **The holder gets their pass, not just the organizer.** Issued passes appear
  on the dashboard and under *My passes*, each with a full-screen QR for a gate,
  a print view that produces a card for a lanyard, and — where the deployment
  is configured for it — an **Add to Apple Wallet** button. The pass page is
  server-rendered and keeps working once loaded, which is the case that matters
  in a paddock with no signal. Only the holder can reach their own pass, and a
  voided one disappears from their list rather than becoming a greyed-out card
  somebody waves at a gate in poor light.

  Apple Wallet needs a Pass Type ID certificate from the Apple Developer
  portal: set `APPLE_WALLET_PASS_TYPE_ID`, `APPLE_WALLET_TEAM_ID`,
  `APPLE_WALLET_SIGNER_CERT`, `APPLE_WALLET_SIGNER_KEY` (PEM, plus
  `APPLE_WALLET_SIGNER_KEY_PASSPHRASE` if it has one) and
  `APPLE_WALLET_WWDR_CERT`. Without them the button is not rendered at all —
  iOS silently refuses an unsigned pass, and a download that produces a file
  the phone rejects is worse than no button, because the person believes they
  have a pass.

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

**The consoles look like one product (done):** the page primitives in
`src/components/ui/page.tsx` existed but only ten of forty-four pages used
them, so `/search` opened with bare markup while `/apply` next door had
breadcrumbs, a description and a proper empty state. Somebody learning the
platform had to re-read each screen instead of recognising it. 27 pages now
carry `PageHeader` and 33 use `Section`; the trackside screens — gate, timing,
broadcast, the scanner, the label sheet — are deliberately exempt, because
they are used standing up by somebody whose whole job for four hours is that
one screen, and the console furniture is screen they do not have.
`tests/page-furniture.test.ts` guards it, with the exemptions listed and a
check that none of them is stale.

Alongside it, four things that were missing rather than inconsistent:

- **Feedback.** Every mutation showed a busy state and then stopped, and 38 of
  164 never rendered their error either. Failures now surface globally so none
  can be silent, and 37 mutations carry a confirmation in their own words.
  Errors never dismiss themselves — one that vanishes before it is read leaves
  somebody knowing only that something failed.
- **Loading and failure.** 56 bare "Loading…" strings became shaped skeletons,
  which keeps the page still instead of shoving content down when data lands.
  There were no `loading.tsx`, `error.tsx` or `not-found.tsx` files anywhere;
  an unhandled throw rendered a blank page with no way back. A failed *query*
  used to render an empty list, which is a silent lie — "there is nothing
  here" when in fact nobody could tell.
- **Forms.** Three `<form>` elements against 278 click handlers meant Enter did
  nothing anywhere, and on a phone the keyboard's Go key did nothing either.
  Single-purpose forms are now real forms; panels of independent row controls
  are deliberately left alone, since wrapping those would make the first button
  the default action for Enter.
- **Desktop navigation.** Six account destinations were reachable only through
  the `lg:hidden` mobile menu, so on a laptop there was no path to Messages, My
  organizations, My passes, My postings, Apply or the sponsor console at all.
  The nav test had passed throughout, because it asked whether a route was
  *listed*, not whether anything rendered it at every width.

**Dark theme (done):** light, dark, or whatever the device says, picked from
the account menu on desktop and the same menu on a phone. It defaults to
following the device, because most people set that once at the operating system
and expect everything to obey it.

It works because the three brand tokens are **semantic rather than literal**.
`brand-black` means *ink* and `brand-offwhite` means *paper*; in dark they swap,
and all 1300-odd existing `text-brand-black/60` usages invert for free, opacity
modifier included, because Tailwind emits `var(--color-brand-black)` and the
cascade re-resolves it. The names are kept as they are on purpose — renaming
them to ink/paper would be more honest and also a 1300-line diff landing in the
same commit as the feature.

Three details that are not obvious:

- **The preference is applied by an inline script before first paint.** A theme
  applied after hydration is one painted frame too late, and on a dark-mode
  phone that frame is a face full of white at a night race. It falls back to
  light rather than throwing, because it runs where an exception leaves the page
  unstyled.
- **Every filled block carries its own foreground.** `bg-brand-red text-white`
  reads fine in light and is unreadable in dark, because the fill lifts for
  legibility against the page while the text stays white. `text-on-red` and
  `text-on-ink` invert with their fills.
- **Ink is not pure white and paper is not pure black.** A #fff-on-#000
  interface produces halation — the smearing readers get on high-contrast dark
  text — and it is worst for exactly the people who turn dark mode on.

Stored twice, doing two jobs: in the browser so the boot script can read it
synchronously, and on the profile so the choice follows somebody to a new
device. The browser copy wins on load, since it is the one already applied.

Circuit maps, QR codes, upload previews and the landing hero stay literal in
both themes — the content dictates their colour, not the interface — and
`tests/theme-coverage.test.ts` holds that line, with the exemptions listed and
a check that none of them is stale.

**Advertising seats is reviewed, not sold (while in testing):** posting on
behalf of a team is gated by an application to the platform admins rather than
by the Recruiter subscription. A seat advert reaches every driver here, so it
is worth a human look — but a subscription was the wrong lock, not least
because on a deployment with no Stripe keys there was no checkout to complete
and no webhook to write the row, so the feature was not gated, it was gone.

The grant attaches to the **team**, not to whoever applied. A manager who
applies and then leaves does not take the team's ability to hire with them,
being approved for one team is not a licence to post for another, and a team
inside an approved organization inherits it — a club should not have to have
the same conversation once per entrant team. Enforced by a CHECK: a recruiting
request carries exactly one subject, and no other kind carries any.

The tier machinery is left standing — `isEntitledTo`, the checkout, the
webhooks — so charging for this again is a one-line change rather than a
rebuild. `hasActiveTier` stays factual so the billing page can keep saying
plainly what is and is not subscribed, while `isEntitledTo` carries the policy
for anything still sold: billing off, everything on; billing on, the
subscription decides.

**Renaming and deleting (done):** a team can be renamed from its Settings tab
— the slug deliberately stays put, so links already shared, QR codes on printed
passes and somebody's browser history all keep working. A rename changes the
name on the door, not the address.

Owners can delete a team outright, guarded by retyping its name, matching what
series and events already had. The impact is counted before the button unlocks
rather than described in prose, and two of those counts reach beyond the team:
**event entries and the race results attached to them cascade**, so deleting a
team removes its cars from entry lists it does not own and takes its finishes
out of championships it did not run. That is the schema's existing behaviour
and what deleting a series already does, but it is spelled out on the panel
because an owner tidying up a defunct team will not otherwise imagine a
championship somewhere else is about to change. Job postings are the exception
— they are SET NULL, so an application somebody sent survives in their own
history with no team attached.

Stock lines can be deleted as well as retired, and the panel argues for
retiring: a part the team has stopped carrying should leave the pick lists
while its ledger survives, because "who took the last set" is the question the
whole feature exists to answer. Deleting is for a line that should never have
existed — a duplicate, a typo, somebody else's stock on the wrong team — and it
asks before discarding movements. Invoice lines are untouched either way: the
link is SET NULL, so a document already sent to a customer keeps its wording
and its figures whatever happens to the shelf behind it.

**Invoicing third-party work (done):** teams take in outside jobs — a corner
rebuild for the garage next door, fabrication for a customer car, an engineer
lent out for a weekend — and then invoice it a week later from notes, in a
spreadsheet, because the platform holding the service record and the parts used
could not produce a document. The garage tab now raises, numbers, prints and
chases one.

**What it is not.** It writes and prints an invoice and records what came in
against it. There is no ledger, no tax return, no card processing, and no
opinion on whether the rate somebody typed is right for where they trade — the
platform does the arithmetic it is given. That boundary is printed on the panel
rather than buried in a tooltip, because a team that believes otherwise finds
out at the worst possible moment. Same discipline as payroll.

The decisions that carry weight:

- **Numbers are assigned on issue, not on creation.** Numbering a draft means
  an abandoned one leaves a hole, and a gap in an invoice run is the first
  thing an auditor asks about. The number is taken inside a retry loop guarded
  by a unique index on (team, number), because two people issuing at once is
  not hypothetical when a manager and an engineer both have the console open.
- **Numbers come off a counter on the team, not `MAX(number) + 1`.** The max
  is wrong the moment an invoice is deleted: the highest number drops back and
  the next invoice reuses one that was already in circulation, so two different
  documents exist under a single reference. The counter only goes up, and
  incrementing it atomically also removes the retry loop the max-scan needed to
  survive two people issuing at once.
- **A void keeps its number and its record**; a deletion takes both away.
  Both are offered, because there is a real case for each — an invoice for work
  that was genuinely done but will not be collected is a void, while one raised
  against the wrong customer entirely is better erased than left on file. What
  matters is that the difference is on screen at the moment of choosing:
  deleting an issued invoice needs an explicit confirmation that spells out the
  lines and payments going with it and the gap left in the run.
- **Amounts are frozen at issue.** Line totals are stored rather than
  recomputed, so a rounding change or a corrected rate cannot silently rewrite
  a document somebody has already paid.
- **Tax is worked out on the taxable subtotal in one go**, not per line and
  summed. Per-line rounding drifts from the figure a customer gets by applying
  the rate to the total themselves, which is the first thing they do and the
  first thing they query.
- **Settlement is derived from the payments**, never stored as a flag, so the
  status and the money cannot disagree. Payments are their own rows because a
  deposit and a balance is the normal shape of a large job and a boolean cannot
  say "half". **Mark paid** is one tap for the common case — it writes a
  payment for exactly the outstanding balance rather than setting a flag, so
  it is the same fact entered faster and not a second source of truth. Against
  a part-paid invoice it records the balance, not the total. The row says it
  was marked rather than itemised, because reconciling a bank statement later
  means telling a real receipt from a tick-off, and it can be taken back off
  again.
- **Overdue invoices join the attention rollup**, first among the urgent items:
  money the team is owed and has not chased is the only thing on that list with
  a deadline somebody else set. Still one batched query — seven for any number
  of teams, not seven per team.

Invoices are manager-scoped rather than roster-scoped, on the same reasoning
that keeps sponsorship terms off the roster. The printed document at
`/teams/[slug]/invoices/[invoiceId]` carries the team's own branding, because
an invoice arriving from a name the customer does not recognise is an invoice
that gets queried.

**Parts get labels, and labels get scanned (done):** the garage stock ledger
now prints QR labels and takes them back in through the camera. A crew loading
a trailer sets the direction once — *taking out* or *putting back* — and then
scans; every part logs itself, no form, no confirm. Getting one wrong is one
tap of Undo, which writes a reversal rather than deleting the row, because a
ledger whose entries can vanish is not an answer to "who took the last set".

There are **two kinds of label**, and the distinction is the design:

- A **bin label** identifies the stock line. Scan it and the count moves. This
  is the right thing for consumables — printing eight identical labels for
  eight sets of pads would be theatre, since scanning any one of them means
  exactly what scanning the shelf means.
- A **part label** identifies one physical thing, with its own serial and its
  own expiry date. Scanning *is* the quantity, so there is no keypad. This
  earns its place where the part has an identity worth following: a gearbox, a
  fire bottle with a date on it, a set of wheels that comes back from a weekend
  bent. Turning it on for a line takes the quantity keypad away, because two
  ways to change one count is two counts.

Details that matter more than they look:

- **The same code is ignored for ten seconds.** A camera decodes eight times a
  second; without this, holding a phone over a label books the same gearbox
  out forty times and the count is wrong by a margin nobody can rebuild.
- **Scanning something out that is already out is not an error** — it usually
  means two people scanned the same box — but it writes no second movement.
- **Scans queue offline.** This is the strongest case for the trackside outbox
  in the whole platform: a trailer at a circuit has no signal, and loading one
  is exactly when somebody scans twenty things in a row. Each scan carries the
  time it happened, so the ledger does not say the shelf emptied on the drive
  home. A replay that would take stock below zero is rejected and stays in the
  outbox rather than being written anyway — a team that scanned out more than
  the system thought it had has a missing receipt, and burying it would turn a
  findable discrepancy into a count nobody can reconcile.
- **A label scanned by somebody outside the team reads as "not found"**, not
  as "forbidden". Labels get photographed in paddocks and left on benches at
  circuits, and a refusal that says "this is somebody's, just not yours"
  confirms the code is live and worth trying elsewhere.
- **The code is never printed smaller than 92px (~24mm).** That floor came
  from rasterising and decoding at print size in `tests/qr.test.ts`, not from
  guessing, and shrinking it to fit more on a page is the one change that looks
  like an improvement and quietly stops the labels working in a dim trailer.
- **Tokens are minted from crypto randomness, never backfilled in SQL.**
  Postgres' `random()` is not a CSPRNG, and a token predictable from a
  neighbouring one would let anybody who photographed one bin walk the team's
  whole parts list. Lines that predate labels get one the first time they are
  printed.

**Publishing needs approving (done):** anyone can sign up, keep a profile,
drive, crew, apply for seats and message people with no gate at all. Four
things need a human first — a **team**, an **organization**, a **championship**
and a **sponsor account** — because those are the four surfaces that put a name
in front of everybody else, and therefore the four that spam uses.

Drawing the line anywhere wider would be worse than the spam it stops. A
platform where a driver cannot make a profile until somebody approves them is a
platform nobody joins, and the queue would fill with people who only wanted to
enter a race.

- **`/apply`** carries the form, one application per kind at a time, and prints
  what a reviewer is actually weighing next to each one. A queue with no stated
  bar gets decided on vibes and then inconsistently.
- **`/admin/access`** is the queue: pending first, longest wait at the top,
  overdue past three days. Every card shows the applicant beside what they
  wrote — how old the account is, whether they are verified, their profile —
  because a decision made from a name alone is arbitrary. A decline must carry
  a note; "no" with no reason is what makes people re-apply blind.
- **An approval buys one thing, not a licence.** It is spent by the creation it
  paid for, inside the same transaction, so a name clash or a failed write
  never burns somebody's application and a second team is a second application.
  Sponsor approvals are the exception and are never spent: there is nothing to
  create, so the approval *is* the grant, and one application covers pitching
  every team.
- **Platform staff bypass the queue.** Making an admin apply to themselves is
  ceremony — they could approve their own request anyway.
- **One address is the platform owner**, baked into
  `src/server/services/platform-admin.ts` and always an admin. Not a
  configuration option to get wrong, which is the point: the queue is reachable
  on a database this code has never touched, before anybody has been promoted
  in it. `PLATFORM_OWNER_EMAIL` overrides it for a fork or a staging copy, and
  `PLATFORM_ADMIN_EMAILS` adds more addresses alongside it. Both are read live
  rather than synced into the column, so whoever controls the deployment can
  always get in even if every admin row is demoted, and removing an address
  revokes on the next request rather than leaving a stale grant.
- **Nobody can demote the owner**, and the last admin cannot demote themselves
  on a deployment with no way back in. Neither is a courtesy: a review queue
  nobody can open does not announce itself — the applications simply stop being
  answered. The seed writes the owner's admin row when their account exists, so
  they *appear* on the staff panel rather than only being one in effect.

**Sponsor console (done):** `/sponsor` is the other end of the sponsorship
rows the team console already holds. A sponsor's deals live across as many team
pages as they back and none of those pages is theirs to open, so this is the
one screen that is: live deals, what is waiting on a reply, committed spend
**split by currency** (summing across currencies needs an exchange rate this
platform has no business inventing), and team discovery with the teams already
in their book marked rather than hidden — renewing with last season's team is
the common case.

Two nudges, both derived rather than stored so they cannot go stale: an offer
nobody has answered in a fortnight, and a live deal inside sixty days of its
end date. Neither is chased automatically — a club team's manager checks the
platform between race weekends, not daily. A sponsor can pull an offer that is
still unanswered; once the team has opened talks it is a conversation, and one
side deleting it would lose the other side's context.

**Phase 3 (in progress):** Pit Wall strategy plans now persist against an
event and can be shared with a team (author-only edit, team read). Remaining:
iRacing auto-sync (blocked on partner API approval) and the verified-badge
pipeline. The CSV/JSON import above is the shipped stopgap.

**Phases 5–6** (AI layer, launch hardening) are scaffolded where
cross-cutting: the AI gateway exists with the production security posture.
Discord guild sync is deferred until OAuth credentials are available.

### Finding things: the command palette

Press <kbd>⌘K</kbd> (or <kbd>Ctrl</kbd>+<kbd>K</kbd>) anywhere, or use the
search box in the header. It is also the first item in the mobile menu.

This exists because the app has forty-five pages under `(dashboard)` and
twenty top-level destinations, ten of them behind an account menu. Features
have shipped and then been reported as missing more than once — not broken,
just unreachable without knowing where to look. Typing the name of a thing is
the shortest path to it that does not require reorganising the app first.

What it searches, in order:

| Group | What is in it |
| --- | --- |
| Recently opened | The last five things you jumped to, per browser |
| Switch to | Your teams, series, organizations and race weekends |
| Jump to | Every console tab and page you can reach, named |
| Do something | Actions with a real address of their own |
| Found on RaceOps | Name search across events, series, teams and tracks |

Three pieces, split by what breaks them:

- `src/lib/command-palette.ts` — matching and ranking. The scorer computes a
  full alignment rather than walking greedily, because greedy gets `sc` wrong
  the moment two commands both start with `s`. Nothing here touches React.
- `src/lib/command-set.ts` — what commands exist, given who you are. Every
  command points at a route that exists; there is no entry for "create an
  invoice" because creating one happens inside a panel and has no address.
- `src/server/trpc/routers/command.ts` — `contexts` (yours, fetched once and
  matched locally) and `search` (the long tail, queried after two characters).

The console tab lists live in `src/lib/nav.ts` as well as in the console pages
themselves, because a real tab also carries content, a visibility rule and a
badge. `tests/nav-consoles.test.ts` fails if the two ever disagree, and also
if any command points at a route that no longer exists.

### Knowing where you are: the context switcher

Inside a team, a series or a race weekend, the header stops showing the nine
directory links and shows what you are operating instead — a switcher naming
the thing, with your other contexts one click away.

The two take turns because there is only room for one. Measured against the
real compiled stylesheet, the header has about thirty pixels of slack at every
width once the logo, the links, the search box and the account cluster have
taken their share; a switcher needs closer to two hundred. That constraint is
also the argument: while you are browsing, the directory *is* the navigation;
the moment you are inside something, that thing is.

Nothing becomes unreachable when the links step aside. The menu button stops
hiding itself on desktop at exactly that point and carries all of them, and
⌘K finds any of them by name. `tests/header-context.test.ts` asserts both.

Two behaviours worth knowing:

- **Switching keeps your place.** From a team's Roster, switching to another
  team lands on *its* Roster rather than its front door. That only holds when
  both consoles have the tab — a team's Garage has no equivalent in a race
  weekend, so that goes to the front door instead.
- **It stays quiet on someone else's page.** Looking at a team you are not in
  is browsing, not operating, so the switcher does not appear and claim you
  are somewhere you are not.

`src/lib/app-context.ts` holds all of it as pure functions over a pathname:
what context a URL is in, where a switch should land, and how the menu groups.

### Browsing: Explore

`/explore` is one faceted search across events, series, teams and tracks.
Everything lives in the query string, so a search survives a reload and can be
sent to somebody — "endurance racing in Georgia next month" is a link, not a
set of instructions.

The header went from nine destinations to six: Events, Series, Teams and
Tracks were four index pages running the same query with the filter nailed
down. **The pages are still there and still at their own URLs** — each carries
things a search cannot, like creating a team or seeing your own entries. What
collapsed is how you browse, not the pages. They stay listed in the mobile
menu under Explore, they link to it from their own headers, and ⌘K still finds
them by name; `tests/nav.test.ts` fails if the menu ever stops rendering them.

Two behaviours worth knowing:

- **Two modes, deliberately.** Narrowed to a single type it paginates like the
  directory it replaces; across everything it shows the best few of each, since
  thirty events with the teams below the fold is the events directory with
  extra steps. It always reports the true count so "see all 41" is honest.
- **A filter that cannot apply drops the type instead of zeroing it.** A track
  has no date and a team has no discipline, so filtering by "this weekend"
  searches events only and the rail says so, rather than returning nothing and
  leaving somebody wondering whether the data is missing.

`src/lib/explore.ts` holds the filter state, the query-string round-trip and
the date windows as pure functions. "This weekend" means the weekend you are
in, not the next one — asked on a Saturday morning, the question is what is on
now.

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
