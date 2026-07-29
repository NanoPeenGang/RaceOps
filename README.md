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

**Phase 2 (done):** opportunities marketplace — posting (individual or team),
application flow with poster-side review and status tracking, Stripe
subscriptions (Recruiter + Sponsor Discovery tiers via Checkout, customer
portal, webhook-synced state), Stripe Connect Express onboarding for
marketplace payouts, and a notification system (in-app + optional Resend
email). Paid gates: posting as a team requires the Recruiter tier; sponsor
search requires Sponsor Discovery.

**Phases 3–6** (iRacing sync + Pit Wall sharing, community, AI layer, launch
hardening) are scaffolded where cross-cutting: the Prisma schema already
models race events, reports, strategy plans, and endorsements; the strategy
calculators and the AI gateway exist with the production security posture.

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
