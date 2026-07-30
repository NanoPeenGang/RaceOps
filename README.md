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
direct connection), so no manual migration step is needed. If you bring your
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
```

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
