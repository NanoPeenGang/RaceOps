import { PlatformRole, PrismaClient } from "@prisma/client";
import { seedReferenceTracks } from "./seed-data/seed-tracks.mts";
import { seedReferenceSeries } from "./seed-data/seed-series.mts";
import {
  STATES_WITHOUT_TRACKS,
  US_REFERENCE_TRACKS,
} from "./seed-data/us-tracks.mts";
import { PLATFORM_OWNER_EMAIL } from "../src/lib/platform-owner.ts";

/**
 * Loads RaceOps' shipped reference data.
 *
 * Run it with `npm run db:seed`, or let `prisma migrate reset` call it. Safe on
 * a database that is already in use: it only adds what is missing and never
 * edits or removes anything (see `seed-data/seed-tracks.mts`).
 *
 * Currently that means the US track directory. Nothing here is user data — no
 * accounts, no series, no events — so this is appropriate to run in production.
 */

/*
 * Prisma migrate and seed both want the *direct* connection. Serverless
 * Postgres providers hand out a pooled URL as DATABASE_URL, and pgbouncer
 * transaction pooling breaks long-running work; prefer the unpooled one where
 * the provider supplies it, matching scripts/migrate-deploy.mjs.
 */
const url =
  process.env.DATABASE_URL_UNPOOLED ??
  process.env.DIRECT_URL ??
  process.env.DATABASE_URL;

if (!url) {
  console.error(
    "db:seed: DATABASE_URL is not set. Point it at your database and try again.",
  );
  process.exit(1);
}

const db = new PrismaClient({ datasources: { db: { url } } });

const layouts = (count: number): string =>
  `${count} layout${count === 1 ? "" : "s"}`;

/**
 * Writes the owner's admin standing into the database.
 *
 * The owner is already an admin without this — `effectivePlatformRole` grants
 * it from the address alone, so the queue is reachable on a database this has
 * never touched. What this adds is that they *appear* as staff on the platform
 * staff panel, which otherwise lists database rows only and would show an
 * empty table on a working deployment.
 *
 * Only ever promotes, and only an account that already exists: the row is
 * created by the auth provider when they first sign in, and inventing one here
 * would put a user with no auth identity in the table.
 */
async function promoteOwner(): Promise<void> {
  const owner = await db.user.findFirst({
    where: { email: { equals: PLATFORM_OWNER_EMAIL, mode: "insensitive" } },
    select: { id: true, platformRole: true },
  });

  if (!owner) {
    console.log(
      `\nPlatform owner ${PLATFORM_OWNER_EMAIL} has not signed in yet — ` +
        "they are an admin from the address alone, and this will record it " +
        "on the next seed after they do.",
    );
    return;
  }
  if (owner.platformRole === PlatformRole.ADMIN) return;

  await db.user.update({
    where: { id: owner.id },
    data: { platformRole: PlatformRole.ADMIN },
  });
  console.log(`\nPlatform owner ${PLATFORM_OWNER_EMAIL} promoted to admin.`);
}

try {
  const states = new Set(US_REFERENCE_TRACKS.map((track) => track.state));
  console.log(
    `Seeding ${US_REFERENCE_TRACKS.length} reference tracks across ${states.size} states…`,
  );

  const summary = await seedReferenceTracks(db);

  for (const outcome of summary.outcomes) {
    if (outcome.status === "skipped") {
      console.log(`  skipped  ${outcome.name} — ${outcome.reason}`);
    } else if (outcome.status === "created") {
      console.log(`  added    ${outcome.name} (${layouts(outcome.layoutsCreated)})`);
    } else if (outcome.layoutsCreated > 0) {
      console.log(`  updated  ${outcome.name} (+${layouts(outcome.layoutsCreated)})`);
    }
  }

  console.log(
    `\n${summary.created} tracks added, ${summary.present} already present, ` +
      `${summary.skipped} skipped; ${summary.layoutsCreated} layouts added.`,
  );
  if (STATES_WITHOUT_TRACKS.length > 0) {
    console.log(
      `No permanent circuit or oval on file for: ${STATES_WITHOUT_TRACKS.join(", ")}.`,
    );
  }

  await promoteOwner();

  const series = await seedReferenceSeries(db);
  console.log(
    `\n${series.seriesCreated} reference series added, ` +
      `${series.seriesPresent} already present, ${series.seriesSkipped} skipped; ` +
      `${series.eventsCreated} rounds and ${series.rulesCreated} regulations added.`,
  );
  if (series.eventsUnlinked > 0) {
    console.log(
      `${series.eventsUnlinked} round${series.eventsUnlinked === 1 ? "" : "s"} ` +
        "could not be linked to a track in the directory and carry a free-text venue.",
    );
  }
} finally {
  await db.$disconnect();
}
