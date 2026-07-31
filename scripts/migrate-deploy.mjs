/**
 * Gets the database ready during a Vercel build (`vercel-build`): applies
 * pending migrations, then loads the shipped reference data.
 *
 * Serverless Postgres providers hand out a *pooled* connection string as
 * DATABASE_URL (great for runtime) and a direct one for DDL. Prisma migrate
 * needs the direct connection — pgbouncer transaction pooling breaks its
 * advisory locks — so prefer the unpooled URL when the provider supplies one
 * (Neon: DATABASE_URL_UNPOOLED, Prisma convention: DIRECT_URL).
 */
import { spawnSync } from "node:child_process";

const directUrl =
  process.env.DATABASE_URL_UNPOOLED ??
  process.env.DIRECT_URL ??
  process.env.DATABASE_URL;

if (!directUrl) {
  console.error(
    "migrate-deploy: DATABASE_URL is not set. Link a Postgres database to " +
      "this project (Vercel -> Storage -> Create Database) and redeploy.",
  );
  process.exit(1);
}

const env = { ...process.env, DATABASE_URL: directUrl };

const migrate = spawnSync("npx", ["prisma", "migrate", "deploy"], {
  stdio: "inherit",
  env,
});

// A schema that did not migrate is a broken deployment: stop here.
if (migrate.status !== 0) process.exit(migrate.status ?? 1);

/*
 * Seed the reference tracks on every deploy.
 *
 * Safe to run repeatedly by construction — it only ever inserts what is
 * missing, never updates or deletes (see prisma/seed-data/seed-tracks.mts) —
 * and running it here is the only thing that actually puts the venue directory
 * in front of anyone. Left as a manual step it simply never happens, and the
 * tracks page stays empty on a perfectly healthy deployment.
 */
const seed = spawnSync(
  "node",
  ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "prisma/seed.mts"],
  { stdio: "inherit", env },
);

/*
 * A seeding failure is not a broken deployment: the app works fine with an
 * empty track list, and blocking a release over optional reference data would
 * be the worse outcome. Say so loudly and carry on.
 */
if (seed.status !== 0) {
  console.warn(
    "\nmigrate-deploy: WARNING — reference tracks did not load (exit " +
      `${seed.status}). The deployment is fine; the track directory will be ` +
      "empty until `npm run db:seed` succeeds.",
  );
}

process.exit(0);
