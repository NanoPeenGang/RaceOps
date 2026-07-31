import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  LayoutShape,
  PrismaClient,
  TrackDirection,
  TrackImageKind,
  TrackKind,
  TrackRuleKind,
} from "@prisma/client";
import { createCaller } from "@/server/trpc/root";
import { layoutDiagram, venueMapUrl } from "@/lib/track-diagram";
import { isStale } from "@/lib/track-rules";
import { imagesForFacility, imagesForLayout } from "@/lib/track-images";
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

describe.skipIf(!ENABLED)("track details and facility rules (integration)", () => {
  const run = Date.now();
  const fixture: SeedTrack[] = [
    {
      name: `Detail Circuit ${run}`,
      kind: TrackKind.CIRCUIT,
      city: "Lakeville",
      state: "ZY",
      layouts: [
        { name: "Full Course", lengthMeters: 2462, turnCount: 7, isPrimary: true },
      ],
      rules: [
        {
          kind: TrackRuleKind.CURFEW,
          title: `No racing on Sundays ${run}`,
          detail: "A court injunction dating from 1959.",
          source: "Town ordinance",
          verifiedOn: "2026-07-01",
        },
      ],
    },
    {
      name: `Detail Oval ${run}`,
      kind: TrackKind.OVAL,
      city: "Lincoln",
      state: "ZY",
      layouts: [
        {
          name: "Superspeedway",
          lengthMeters: 4281,
          direction: TrackDirection.ANTICLOCKWISE,
          turnCount: 4,
          shape: LayoutShape.TRI_OVAL,
          bankingDegrees: 33,
          isPrimary: true,
        },
      ],
    },
  ];
  const slugs = fixture.map(referenceSlug);
  let driver: Awaited<ReturnType<typeof makeUser>>;

  beforeAll(async () => {
    driver = await makeUser(`detailuser_${run}`);
    await seedReferenceTracks(db, fixture);
  });

  afterAll(async () => {
    if (!ENABLED) return;
    await db.track.deleteMany({ where: { region: "ZY" } });
    await db.user.deleteMany({ where: { id: driver.user.id } });
  });

  it("stores the figures a schematic is drawn from", async () => {
    const layout = await db.trackLayout.findFirstOrThrow({
      where: { track: { slug: slugs[1] } },
    });
    expect(layout.turnCount).toBe(4);
    expect(layout.shape).toBe(LayoutShape.TRI_OVAL);
    expect(layout.bankingDegrees).toBe(33);
    // A drawable layout is exactly one the diagram function accepts.
    expect(layoutDiagram(layout)).not.toBeNull();
  });

  it("leaves a road course undrawable rather than inventing an outline", async () => {
    const layout = await db.trackLayout.findFirstOrThrow({
      where: { track: { slug: slugs[0] } },
    });
    expect(layout.shape).toBeNull();
    expect(layoutDiagram(layout)).toBeNull();
  });

  it("seeds a sourced rule and serves it on the track page", async () => {
    const track = await driver.caller.track.bySlug({ slug: slugs[0] });
    expect(track.rules).toHaveLength(1);
    expect(track.rules[0].kind).toBe(TrackRuleKind.CURFEW);
    expect(track.rules[0].source).toBe("Town ordinance");
    expect(track.rules[0].verifiedOn).toBeInstanceOf(Date);
  });

  it("adds no rule twice, however often the seed runs", async () => {
    const summary = await seedReferenceTracks(db, fixture);
    expect(summary.rulesCreated).toBe(0);
    expect(
      await db.trackRule.count({ where: { track: { slug: slugs[0] } } }),
    ).toBe(1);
  });

  it("leaves an edited rule alone on the next deploy", async () => {
    // Same contract as the rest of the seed: a club that corrected the dB
    // figure from experience must not have it reverted by a redeploy.
    const track = await driver.caller.track.bySlug({ slug: slugs[0] });
    await driver.caller.track.updateRule({
      ruleId: track.rules[0].id,
      detail: "Corrected by the club that runs here.",
    });

    await seedReferenceTracks(db, fixture);

    const after = await driver.caller.track.bySlug({ slug: slugs[0] });
    expect(after.rules).toHaveLength(1);
    expect(after.rules[0].detail).toBe("Corrected by the club that runs here.");
  });

  it("lets a curator add, verify and remove a rule", async () => {
    const track = await driver.caller.track.bySlug({ slug: slugs[1] });
    const added = await driver.caller.track.addRule({
      trackId: track.id,
      kind: TrackRuleKind.SOUND,
      title: "No sound limit",
      source: "Circuit regulations",
    });
    expect(added.verifiedOn).toBeNull();

    const verified = await driver.caller.track.verifyRule({ ruleId: added.id });
    expect(verified.verifiedOn).toBeInstanceOf(Date);
    expect(isStale(verified.verifiedOn)).toBe(false);

    await driver.caller.track.deleteRule({ ruleId: added.id });
    expect(
      await db.trackRule.count({ where: { track: { slug: slugs[1] } } }),
    ).toBe(0);
  });

  it("audits a rule change on a reference track", async () => {
    // Open editing is only defensible with a trail — the same rule that
    // applies to correcting the track itself.
    const track = await driver.caller.track.bySlug({ slug: slugs[0] });
    await driver.caller.track.updateRule({
      ruleId: track.rules[0].id,
      source: "Town ordinance, re-checked",
    });
    const entries = await db.auditEvent.count({
      where: { entityType: "TrackRule", actorId: driver.user.id },
    });
    expect(entries).toBeGreaterThan(0);
  });

  it("fills a field added after the database was seeded", async () => {
    /*
     * The failure this guards against is silent and total: a deployment
     * seeded before turn counts existed would otherwise keep a column of
     * nulls forever, because the rows already existed and an insert-only
     * seed never touches them. The directory would only ever be complete on
     * a database nobody has.
     */
    const layout = await db.trackLayout.findFirstOrThrow({
      where: { track: { slug: slugs[1] } },
    });
    await db.trackLayout.update({
      where: { id: layout.id },
      data: { turnCount: null, shape: null, bankingDegrees: null },
    });

    await seedReferenceTracks(db, fixture);

    const after = await db.trackLayout.findUniqueOrThrow({
      where: { id: layout.id },
    });
    expect(after.turnCount).toBe(4);
    expect(after.shape).toBe(LayoutShape.TRI_OVAL);
    expect(after.bankingDegrees).toBe(33);
  });

  it("still refuses to overwrite a field that holds an answer", async () => {
    // Filling a null takes nothing from anyone. Replacing a value somebody
    // set is the line this script does not cross, on any field.
    const layout = await db.trackLayout.findFirstOrThrow({
      where: { track: { slug: slugs[1] } },
    });
    await db.trackLayout.update({
      where: { id: layout.id },
      data: { turnCount: 99, bankingDegrees: 1 },
    });

    await seedReferenceTracks(db, fixture);

    const after = await db.trackLayout.findUniqueOrThrow({
      where: { id: layout.id },
    });
    expect(after.turnCount).toBe(99);
    expect(after.bankingDegrees).toBe(1);
  });

  it("keeps coordinates and address round-tripping through the router", async () => {
    const track = await driver.caller.track.bySlug({ slug: slugs[1] });
    await driver.caller.track.update({
      trackId: track.id,
      addressLine: "3366 Speedway Blvd",
      postalCode: "35160",
      latitude: 33.5687,
      longitude: -86.0661,
    });
    const after = await driver.caller.track.bySlug({ slug: slugs[1] });
    expect(after.addressLine).toBe("3366 Speedway Blvd");
    expect(after.latitude).toBeCloseTo(33.5687, 4);
    // The map link prefers a real pin over a name search once it has one.
    expect(venueMapUrl({ ...after, name: after.name })).toContain("33.5687");
  });
});

describe.skipIf(!ENABLED)("track photographs (integration)", () => {
  const run = Date.now();
  let owner: Awaited<ReturnType<typeof makeUser>>;
  let stranger: Awaited<ReturnType<typeof makeUser>>;
  let ownTrackId: string;
  let ownLayoutId: string;
  let referenceTrackId: string;
  let referenceLayoutId: string;

  beforeAll(async () => {
    owner = await makeUser(`imgowner_${run}`);
    stranger = await makeUser(`imgother_${run}`);

    const own = await owner.caller.track.create({
      name: `Photo Park ${run}`,
      country: "us",
      region: "ZX",
      city: "Millville",
      firstLayoutName: "Thunderbolt",
    });
    ownTrackId = own.id;
    ownLayoutId = own.layouts[0].id;

    await seedReferenceTracks(db, [
      {
        name: `Photo Reference ${run}`,
        kind: TrackKind.CIRCUIT,
        city: "Elkhart Lake",
        state: "ZX",
        layouts: [{ name: "Full Course", lengthMeters: 6515, isPrimary: true }],
      },
    ]);
    const reference = await db.track.findFirstOrThrow({
      where: { region: "ZX", isReference: true },
      include: { layouts: true },
    });
    referenceTrackId = reference.id;
    referenceLayoutId = reference.layouts[0].id;
  });

  afterAll(async () => {
    if (!ENABLED) return;
    await db.track.deleteMany({ where: { region: "ZX" } });
    await db.user.deleteMany({
      where: { id: { in: [owner.user.id, stranger.user.id] } },
    });
  });

  it("attaches a map to a layout and serves it on the track page", async () => {
    const added = await owner.caller.track.addImage({
      trackId: ownTrackId,
      layoutId: ownLayoutId,
      kind: TrackImageKind.MAP,
      url: "https://example.test/thunderbolt.png",
      caption: "2024 configuration",
      credit: "New Jersey Motorsports Park",
    });
    expect(added.position).toBe(0);
    expect(added.uploadedById).toBe(owner.user.id);

    const track = await owner.caller.track.bySlug({
      slug: (await db.track.findUniqueOrThrow({ where: { id: ownTrackId } })).slug,
    });
    expect(track.images).toHaveLength(1);
    expect(track.images[0].credit).toBe("New Jersey Motorsports Park");
    // The uploader is carried so a gallery can say who added a picture.
    expect(track.images[0].uploadedBy?.profile?.displayName).toContain("imgowner");
  });

  it("keeps facility images unattached to any layout", async () => {
    // A paddock plan belongs to the venue. Forcing it onto a layout would put
    // it on the wrong card and hide it from anyone reading a different one.
    const added = await owner.caller.track.addImage({
      trackId: ownTrackId,
      kind: TrackImageKind.PADDOCK,
      url: "https://example.test/paddock.png",
    });
    expect(added.layoutId).toBeNull();

    const all = await db.trackImage.findMany({ where: { trackId: ownTrackId } });
    expect(imagesForLayout(all, ownLayoutId)).toHaveLength(1);
    expect(imagesForFacility(all)).toHaveLength(1);
  });

  it("appends, so an arranged gallery is not reshuffled by an upload", async () => {
    const added = await owner.caller.track.addImage({
      trackId: ownTrackId,
      layoutId: ownLayoutId,
      kind: TrackImageKind.AERIAL,
      url: "https://example.test/aerial.jpg",
    });
    expect(added.position).toBe(2);
  });

  it("refuses the same image twice", async () => {
    await expect(
      owner.caller.track.addImage({
        trackId: ownTrackId,
        layoutId: ownLayoutId,
        url: "https://example.test/thunderbolt.png",
      }),
    ).rejects.toThrow(/already on this track/i);
  });

  it("refuses a layout that belongs to another track", async () => {
    // Otherwise a layout id is a way to write an image onto a venue the caller
    // was never authorised for.
    await expect(
      owner.caller.track.addImage({
        trackId: ownTrackId,
        layoutId: referenceLayoutId,
        url: "https://example.test/wrong-track.png",
      }),
    ).rejects.toThrow(/not part of this track/i);
  });

  it("lets nobody but the curator add to a community track", async () => {
    await expect(
      stranger.caller.track.addImage({
        trackId: ownTrackId,
        url: "https://example.test/uninvited.png",
      }),
    ).rejects.toThrow(/Only the person who added this track/i);
  });

  it("lets anyone signed in add to a reference track, and audits it", async () => {
    // This is the whole point: the platform will not draw a road course, so
    // uploads are the only way most circuits ever get a picture. Restricting
    // that to a creator nobody has would leave the gap open forever.
    const added = await stranger.caller.track.addImage({
      trackId: referenceTrackId,
      layoutId: referenceLayoutId,
      kind: TrackImageKind.MAP,
      url: "https://example.test/reference-map.png",
    });
    expect(added.id).toBeTruthy();

    const audits = await db.auditEvent.count({
      where: { entityType: "TrackImage", actorId: stranger.user.id },
    });
    expect(audits).toBeGreaterThan(0);
  });

  it("reorders one step at a time and renumbers the whole gallery", async () => {
    const before = await db.trackImage.findMany({
      where: { trackId: ownTrackId, layoutId: ownLayoutId },
      orderBy: { position: "asc" },
    });
    const last = before[before.length - 1];

    await owner.caller.track.moveImage({ imageId: last.id, direction: "up" });

    const after = await db.trackImage.findMany({
      where: { trackId: ownTrackId },
      orderBy: { position: "asc" },
    });
    expect(after.map((i) => i.position)).toEqual([0, 1, 2]);
    expect(after[1].id).toBe(last.id);
  });

  it("says so rather than throwing when an image is already at the end", async () => {
    const first = await db.trackImage.findFirstOrThrow({
      where: { trackId: ownTrackId },
      orderBy: { position: "asc" },
    });
    expect(
      await owner.caller.track.moveImage({ imageId: first.id, direction: "up" }),
    ).toEqual({ moved: false });
  });

  it("edits a caption and credit without touching the file", async () => {
    const image = await db.trackImage.findFirstOrThrow({
      where: { trackId: ownTrackId },
    });
    const updated = await owner.caller.track.updateImage({
      imageId: image.id,
      caption: "Repaved winter 2026",
      credit: "Photo: the club",
    });
    expect(updated.url).toBe(image.url);
    expect(updated.caption).toBe("Repaved winter 2026");
  });

  it("removes an image, and only for someone who may curate", async () => {
    const image = await db.trackImage.findFirstOrThrow({
      where: { trackId: ownTrackId },
    });
    await expect(
      stranger.caller.track.deleteImage({ imageId: image.id }),
    ).rejects.toThrow(/Only the person who added this track/i);

    await owner.caller.track.deleteImage({ imageId: image.id });
    expect(
      await db.trackImage.count({ where: { id: image.id } }),
    ).toBe(0);
  });

  it("takes the gallery with the track when the track goes", async () => {
    // Orphaned rows pointing at deleted venues are how a directory rots.
    const doomed = await owner.caller.track.create({
      name: `Doomed Park ${run}`,
      country: "us",
      region: "ZX",
      firstLayoutName: "Course",
    });
    await owner.caller.track.addImage({
      trackId: doomed.id,
      url: "https://example.test/doomed.png",
    });
    await owner.caller.track.delete({ trackId: doomed.id });
    expect(
      await db.trackImage.count({ where: { trackId: doomed.id } }),
    ).toBe(0);
  });
});

afterAll(async () => {
  if (ENABLED) await db.$disconnect();
});
