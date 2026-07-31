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
 *    track, layout and rule is matched before it is written.
 * 2. **Never destructive.** Reference tracks are editable in-app — that is the
 *    whole point of `Track.isReference` — so a re-run must not quietly undo a
 *    correction somebody made. Nothing that holds a value is ever overwritten,
 *    and nothing is ever deleted.
 *
 * ## Adding versus overwriting versus filling a blank
 *
 * The first version of this script only ever inserted whole rows, and that
 * turned out to be too strict in one specific way: when the dataset gains a
 * *new field* — turn counts, an oval's shape, banking — every database that
 * already had the tracks kept a column of nulls forever, because the rows
 * existed and nothing else would touch them. The directory would only be
 * complete on a database seeded from empty, which is nobody's.
 *
 * So there are three operations here, and the middle one is the new part:
 *
 * - **Add** a row that is not there. Always safe.
 * - **Fill** a column that is currently NULL with a value we now have. Safe,
 *   because a null is the absence of an answer rather than somebody's answer —
 *   filling it takes nothing away from anyone.
 * - **Overwrite** a column that already holds a value. Never done. This is the
 *   line that keeps the script runnable on production: correcting a figure in
 *   `us-tracks.mts` still does not propagate to a database where somebody has
 *   already set that field, and correcting it in the app still wins.
 */

/** Outcome for one track, so the caller can print something useful. */
export type TrackOutcome =
  | { status: "created"; name: string; layoutsCreated: number; rulesCreated: number }
  | { status: "present"; name: string; layoutsCreated: number; rulesCreated: number }
  | { status: "skipped"; name: string; reason: string };

export interface SeedSummary {
  created: number;
  present: number;
  skipped: number;
  layoutsCreated: number;
  rulesCreated: number;
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
    rulesCreated: outcomes.reduce(
      (total, o) => total + (o.status === "skipped" ? 0 : o.rulesCreated),
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
    await fillTrackBlanks(db, existing.id, track);
    return {
      status: "present",
      name: track.name,
      layoutsCreated: await addMissingLayouts(db, existing.id, track),
      rulesCreated: await addMissingRules(db, existing.id, track),
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
      latitude: track.latitude ?? null,
      longitude: track.longitude ?? null,
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
    rulesCreated: await addMissingRules(db, created.id, track),
  };
}

/**
 * Fills in layout columns that are still empty.
 *
 * This is what carries a new field — turn count, shape, banking — onto a
 * database that was seeded before the field existed. Anything already set
 * stays exactly as it is.
 */
async function fillLayoutBlanks(
  db: PrismaClient,
  trackId: string,
  layout: SeedTrack["layouts"][number],
): Promise<void> {
  const current = await db.trackLayout.findUnique({
    where: { trackId_name: { trackId, name: layout.name } },
    select: {
      id: true,
      lengthMeters: true,
      turnCount: true,
      shape: true,
      bankingDegrees: true,
    },
  });
  if (!current) return;

  const data: Record<string, unknown> = {};
  if (current.lengthMeters === null && layout.lengthMeters !== undefined) {
    data.lengthMeters = layout.lengthMeters;
  }
  if (current.turnCount === null && layout.turnCount !== undefined) {
    data.turnCount = layout.turnCount;
  }
  if (current.shape === null && layout.shape !== undefined) {
    data.shape = layout.shape;
  }
  if (current.bankingDegrees === null && layout.bankingDegrees !== undefined) {
    data.bankingDegrees = layout.bankingDegrees;
  }

  if (Object.keys(data).length > 0) {
    await db.trackLayout.update({ where: { id: current.id }, data });
  }
}

/**
 * Adds any facility rule the track does not already have, matched on title.
 *
 * Same additive contract as everything else here: a rule somebody has edited
 * in the app — corrected a dB figure, added the detail their club learned the
 * hard way — survives the next deploy untouched. Title is the match key
 * because it is the part a correction least often changes; if somebody does
 * reword the title, the seed adds its version back and a curator deletes one,
 * which is a visible, fixable outcome rather than a silent overwrite.
 */
async function addMissingRules(
  db: PrismaClient,
  trackId: string,
  track: SeedTrack,
): Promise<number> {
  if (!track.rules?.length) return 0;

  const present = await db.trackRule.findMany({
    where: { trackId },
    select: { title: true },
  });
  const titles = new Set(present.map((rule) => rule.title));
  let created = 0;

  for (const rule of track.rules) {
    if (titles.has(rule.title)) continue;
    await db.trackRule.create({
      data: {
        trackId,
        kind: rule.kind,
        title: rule.title,
        detail: rule.detail ?? null,
        source: rule.source ?? null,
        sourceUrl: rule.sourceUrl ?? null,
        verifiedOn: rule.verifiedOn ? new Date(rule.verifiedOn) : null,
      },
    });
    created += 1;
  }

  return created;
}

/**
 * Fills in track columns that are still empty, leaving any answer alone.
 *
 * Only touches the fields this dataset can supply. `city` and `name` are not
 * here on purpose: those are always populated, so "fill if null" would never
 * fire, and including them would invite somebody to relax the rule later.
 */
async function fillTrackBlanks(
  db: PrismaClient,
  trackId: string,
  track: SeedTrack,
): Promise<void> {
  const current = await db.track.findUnique({
    where: { id: trackId },
    select: { latitude: true, longitude: true, licenceGrade: true, notes: true },
  });
  if (!current) return;

  const data: Record<string, unknown> = {};
  // Coordinates go in as a pair or not at all: half a position is not a place.
  if (
    current.latitude === null &&
    current.longitude === null &&
    track.latitude !== undefined &&
    track.longitude !== undefined
  ) {
    data.latitude = track.latitude;
    data.longitude = track.longitude;
  }
  if (current.licenceGrade === null && track.licenceGrade !== undefined) {
    data.licenceGrade = track.licenceGrade;
  }
  if (current.notes === null && track.notes !== undefined) {
    data.notes = track.notes;
  }

  if (Object.keys(data).length > 0) {
    await db.track.update({ where: { id: trackId }, data });
  }
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
    if (names.has(layout.name)) {
      await fillLayoutBlanks(db, trackId, layout);
      continue;
    }

    await db.trackLayout.create({
      data: {
        trackId,
        name: layout.name,
        lengthMeters: layout.lengthMeters ?? null,
        turnCount: layout.turnCount ?? null,
        shape: layout.shape ?? null,
        bankingDegrees: layout.bankingDegrees ?? null,
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
