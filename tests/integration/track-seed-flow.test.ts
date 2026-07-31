import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient, TrackKind, TrackDirection } from "@prisma/client";
import { createCaller } from "@/server/trpc/root";
import {
  referenceSlug,
  seedReferenceTracks,
} from "../../prisma/seed-data/seed-tracks.mts";
import type { SeedTrack } from "../../prisma/seed-data/us-tracks.mts";

/**
 * Seeding the reference track directory.
 *
 * This runs against databases with people's championships in them, so the
 * behaviour that matters is what it does the *second* time: it must not double
 * the directory, must not overwrite a correction somebody made in the app, and
 * must not fight with a track a user added by hand. Opt in with RUN_DB_TESTS=1.
 */
const ENABLED = process.env.RUN_DB_TESTS === "1";
const db = ENABLED ? new PrismaClient() : (null as unknown as PrismaClient);

function callerFor(clerkUserId: string | null) {
  return createCaller({ db, clerkUserId, headers: new Headers() });
}

async function makeUser(suffix: string) {
  const user = await db.user.create({
    data: {
      email: `${suffix}@example.test`,
      authProviderId: `clerk_${suffix}`,
      profile: { create: { displayName: suffix } },
    },
  });
  return { user, caller: callerFor(user.authProviderId) };
}

describe.skipIf(!ENABLED)("reference track seeding (integration)", () => {
  const run = Date.now();
  // A private fixture rather than the real 141-track list: this test is about
  // the seeding rules, and asserting against shipped data would make every
  // future correction to us-tracks.ts break the test suite.
  const fixture: SeedTrack[] = [
    {
      name: `Seed Circuit ${run}`,
      kind: TrackKind.CIRCUIT,
      city: "Elkhart Lake",
      state: "ZZ",
      licenceGrade: "Club",
      notes: "Fixture.",
      layouts: [
        {
          name: "Grand Prix",
          lengthMeters: 6515,
          direction: TrackDirection.CLOCKWISE,
          isPrimary: true,
        },
      ],
    },
    {
      name: `Seed Oval ${run}`,
      kind: TrackKind.OVAL,
      city: "Speedway",
      state: "ZZ",
      layouts: [
        {
          name: "Oval",
          lengthMeters: 4023,
          direction: TrackDirection.ANTICLOCKWISE,
          isPrimary: true,
        },
      ],
    },
  ];

  const slugs = fixture.map(referenceSlug);
  let driver: Awaited<ReturnType<typeof makeUser>>;

  beforeAll(async () => {
    driver = await makeUser(`seeduser_${run}`);
  });

  afterAll(async () => {
    if (!ENABLED) return;
    await db.track.deleteMany({ where: { region: "ZZ" } });
    await db.user.deleteMany({ where: { id: driver.user.id } });
    await db.$disconnect();
  });

  it("creates the tracks it does not find, as reference tracks with no owner", async () => {
    const summary = await seedReferenceTracks(db, fixture);
    expect(summary.created).toBe(2);
    expect(summary.skipped).toBe(0);
    expect(summary.layoutsCreated).toBe(2);

    const track = await db.track.findUnique({
      where: { slug: slugs[0] },
      include: { layouts: true },
    });
    expect(track?.isReference).toBe(true);
    // No creator is what makes the track correctable by anyone.
    expect(track?.createdById).toBeNull();
    expect(track?.country).toBe("US");
    expect(track?.region).toBe("ZZ");
    expect(track?.city).toBe("Elkhart Lake");
    expect(track?.layouts[0].lengthMeters).toBe(6515);
    expect(track?.layouts[0].isPrimary).toBe(true);
  });

  it("adds nothing on a second run", async () => {
    const summary = await seedReferenceTracks(db, fixture);
    expect(summary.created).toBe(0);
    expect(summary.present).toBe(2);
    expect(summary.layoutsCreated).toBe(0);

    expect(await db.track.count({ where: { region: "ZZ" } })).toBe(2);
  });

  it("leaves an in-app correction alone rather than resetting it", async () => {
    // The point of a reference track is that anyone can fix it. That is worth
    // nothing if the next deploy silently puts the wrong figure back.
    const track = await db.track.findUniqueOrThrow({
      where: { slug: slugs[0] },
      include: { layouts: true },
    });
    await driver.caller.track.updateLayout({
      layoutId: track.layouts[0].id,
      lengthMeters: 6510,
    });
    await driver.caller.track.update({ trackId: track.id, city: "Plymouth" });

    await seedReferenceTracks(db, fixture);

    const after = await db.track.findUniqueOrThrow({
      where: { slug: slugs[0] },
      include: { layouts: true },
    });
    expect(after.layouts[0].lengthMeters).toBe(6510);
    expect(after.city).toBe("Plymouth");
  });

  it("adds a configuration that appears in a later version of the data", async () => {
    const extended = fixture.map((track, index) =>
      index === 0
        ? {
            ...track,
            layouts: [
              ...track.layouts,
              { name: "Bend Bypass", lengthMeters: 4023 },
            ],
          }
        : track,
    );

    const summary = await seedReferenceTracks(db, extended);
    expect(summary.layoutsCreated).toBe(1);

    const layouts = await db.trackLayout.findMany({
      where: { track: { slug: slugs[0] } },
      orderBy: { name: "asc" },
    });
    expect(layouts.map((layout) => layout.name)).toEqual([
      "Bend Bypass",
      "Grand Prix",
    ]);
    // The existing primary keeps the flag; a new layout does not steal it.
    expect(layouts.filter((layout) => layout.isPrimary)).toHaveLength(1);
    expect(layouts.find((layout) => layout.isPrimary)?.name).toBe("Grand Prix");
  });

  it("stands aside for a venue somebody already added by hand", async () => {
    // Two rows for one circuit would split its lap records in half, which is
    // the exact failure the shared track table exists to prevent.
    const name = `Community Park ${run}`;
    const own = await driver.caller.track.create({
      name,
      country: "us",
      region: "ZZ",
      city: "Millville",
      firstLayoutName: "Thunderbolt",
    });

    const summary = await seedReferenceTracks(db, [
      {
        name,
        kind: TrackKind.CIRCUIT,
        city: "Millville",
        state: "ZZ",
        layouts: [{ name: "Thunderbolt", lengthMeters: 3862, isPrimary: true }],
      },
    ]);

    expect(summary.created).toBe(0);
    expect(summary.skipped).toBe(1);
    expect(
      await db.track.count({
        where: { region: "ZZ", name: { equals: name, mode: "insensitive" } },
      }),
    ).toBe(1);
    // And it stays theirs — ownership is not quietly transferred.
    const untouched = await db.track.findUniqueOrThrow({
      where: { id: own.id },
    });
    expect(untouched.isReference).toBe(false);
    expect(untouched.createdById).toBe(driver.user.id);
  });

  it("lets anyone fix a seeded track, and nobody delete one", async () => {
    const track = await db.track.findUniqueOrThrow({
      where: { slug: slugs[1] },
    });

    await driver.caller.track.update({
      trackId: track.id,
      notes: "Repaved over the winter.",
    });
    expect(
      (await db.track.findUniqueOrThrow({ where: { id: track.id } })).notes,
    ).toBe("Repaved over the winter.");

    await expect(
      driver.caller.track.delete({ trackId: track.id }),
    ).rejects.toThrow(/reference track/i);
  });
});
