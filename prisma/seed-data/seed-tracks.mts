import type { PrismaClient } from "@prisma/client";
import { slugify } from "../../src/lib/slug.ts";
import { US_REFERENCE_TRACKS, type SeedTrack } from "./us-tracks.mts";

/**
 * Loads the reference track directory into a database.
 *
 * Two properties matter more than speed here, because this runs against
 * databases that already have people's work in them:
 *
 * 1. **Idempotent.** Running it twice must not double the directory. Every
 *    track and layout is matched before it is written.
 * 2. **Never destructive.** Reference tracks are editable in-app — that is the
 *    whole point of `Track.isReference` — so a re-run must not quietly undo a
 *    correction somebody made. Existing rows are left exactly as they are,
 *    including ones this script created on a previous run. New tracks and new
 *    layouts are added; nothing is updated and nothing is deleted.
 *
 * The consequence is that fixing a wrong figure in `us-tracks.ts` does not
 * propagate to a database that already has the track. That is the right trade:
 * a script that overwrites is a script nobody dares run on production.
 */

/** Outcome for one track, so the caller can print something useful. */
export type TrackOutcome =
  | { status: "created"; name: string; layoutsCreated: number }
  | { status: "present"; name: string; layoutsCreated: number }
  | { status: "skipped"; name: string; reason: string };

export interface SeedSummary {
  created: number;
  present: number;
  skipped: number;
  layoutsCreated: number;
  outcomes: TrackOutcome[];
}

/**
 * Slug for a seeded track.
 *
 * Keyed on the state rather than the country, because within the US the state
 * is what actually disambiguates: there are several "Thunder Valley"s and only
 * one per state. Deterministic, so a second run finds the same row.
 */
export function referenceSlug(track: Pick<SeedTrack, "name" | "state">): string {
  return slugify(`${track.name} ${track.state}`);
}

/**
 * Inserts the reference tracks that are not already present.
 *
 * @param db Prisma client — any transaction-capable client will do.
 * @param tracks Defaults to the shipped US directory; overridable for tests.
 */
export async function seedReferenceTracks(
  db: PrismaClient,
  tracks: readonly SeedTrack[] = US_REFERENCE_TRACKS,
): Promise<SeedSummary> {
  const outcomes: TrackOutcome[] = [];

  for (const track of tracks) {
    outcomes.push(await seedOneTrack(db, track));
  }

  return {
    created: outcomes.filter((o) => o.status === "created").length,
    present: outcomes.filter((o) => o.status === "present").length,
    skipped: outcomes.filter((o) => o.status === "skipped").length,
    layoutsCreated: outcomes.reduce(
      (total, o) => total + (o.status === "skipped" ? 0 : o.layoutsCreated),
      0,
    ),
    outcomes,
  };
}

async function seedOneTrack(
  db: PrismaClient,
  track: SeedTrack,
): Promise<TrackOutcome> {
  const slug = referenceSlug(track);

  /*
   * Two ways this venue might already be here. Either a previous run created
   * it, in which case the slug matches; or somebody added it by hand before
   * the seed ever ran, in which case the slug is whatever the track router
   * generated but the name and state still line up. Matching on both stops the
   * directory acquiring two rows for one circuit, which would split its lap
   * records in half — the exact failure the shared track table exists to avoid.
   */
  const existing = await db.track.findFirst({
    where: {
      OR: [
        { slug },
        {
          name: { equals: track.name, mode: "insensitive" },
          region: track.state,
        },
      ],
    },
    select: { id: true, name: true, isReference: true },
  });

  if (existing && !existing.isReference) {
    return {
      status: "skipped",
      name: track.name,
      reason: "already in the directory as a community track",
    };
  }

  if (existing) {
    return {
      status: "present",
      name: track.name,
      layoutsCreated: await addMissingLayouts(db, existing.id, track),
    };
  }

  const created = await db.track.create({
    data: {
      name: track.name,
      slug,
      kind: track.kind,
      country: "US",
      region: track.state,
      city: track.city,
      licenceGrade: track.licenceGrade ?? null,
      notes: track.notes ?? null,
      isReference: true,
      // No creator: nobody owns a reference track, which is what opens it to
      // correction by anyone. Enforced by a CHECK constraint in the schema.
      createdById: null,
    },
    select: { id: true },
  });

  return {
    status: "created",
    name: track.name,
    layoutsCreated: await addMissingLayouts(db, created.id, track),
  };
}

/**
 * Adds any layout the track does not already have, by name.
 *
 * At most one layout on a track may be flagged primary, so a configuration
 * added to a track that already has a primary comes in unflagged rather than
 * silently demoting whichever one the organizers are actually using.
 */
async function addMissingLayouts(
  db: PrismaClient,
  trackId: string,
  track: SeedTrack,
): Promise<number> {
  const present = await db.trackLayout.findMany({
    where: { trackId },
    select: { name: true, isPrimary: true },
  });
  const names = new Set(present.map((layout) => layout.name));
  let hasPrimary = present.some((layout) => layout.isPrimary);
  let created = 0;

  for (const layout of track.layouts) {
    if (names.has(layout.name)) continue;

    await db.trackLayout.create({
      data: {
        trackId,
        name: layout.name,
        lengthMeters: layout.lengthMeters ?? null,
        ...(layout.direction ? { direction: layout.direction } : {}),
        isPrimary: Boolean(layout.isPrimary) && !hasPrimary,
        notes: layout.notes ?? null,
      },
    });

    if (layout.isPrimary && !hasPrimary) hasPrimary = true;
    created += 1;
  }

  return created;
}
