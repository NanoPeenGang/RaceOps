# RaceOps

Motorsport networking & career platform: one place for sim racers, real-world
drivers, crew, engineers, sponsors, and industry professionals — with a
sim-to-real credibility pipeline, an opportunities marketplace, and Pit Wall
race-strategy tools.

## Stack

- **Next.js 15** (App Router) · TypeScript · Tailwind CSS 4
- **tRPC v11** for type-safe client/server contracts · TanStack Query
- **PostgreSQL** via **Prisma** (Neon/Supabase in production)
- **Clerk** authentication (Google + Discord OAuth)
- **Upstash Redis** for rate limiting
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

Phase 1 (this codebase): auth + onboarding, unified profiles with manual sim
stats, search/discovery with filters, team pages & roster management, CI.
Phases 2–6 (marketplace/Stripe, iRacing sync + Pit Wall sharing, community,
AI layer, launch hardening) are scaffolded where cross-cutting: the Prisma
schema already models opportunities, applications, race events, reports,
strategy plans, and endorsements; webhook handlers and the AI gateway exist
with the production security posture (signature verification, auth, rate
limits).

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
