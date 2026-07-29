/**
 * Applies pending Prisma migrations during a Vercel build (`vercel-build`).
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

const result = spawnSync("npx", ["prisma", "migrate", "deploy"], {
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: directUrl },
});

process.exit(result.status ?? 1);
