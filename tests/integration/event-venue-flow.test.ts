import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PlatformRole,
  PrismaClient,
  SeriesDiscipline,
  TrackDirection,
  TrackImageKind,
  TrackKind,
} from "@prisma/client";
import { createCaller } from "@/server/trpc/root";
import { primaryImage } from "@/lib/track-images";
import { seedReferenceTracks } from "../../prisma/seed-data/seed-tracks.mts";

/**
 * Choosing an event's venue from the shared track directory.
 *
 * The point of the directory is that a meeting links to a real layout rather
 * than carrying a typed string: that link is what gives the event page a map,
 * lets an incident name a corner, and files the weekend's laps under the
 * venue's records. Opt in with RUN_DB_TESTS=1.
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
      // Platform staff, so these fixtures bypass the access-request queue —
      // the queue itself is exercised in access-flow.test.ts, and making every
      // suite apply for a team first would test one gate thirty times.
      platformRole: PlatformRole.ADMIN,
      profile: { create: { displayName: suffix } },
    },
  });
  return { user, caller: callerFor(user.authProviderId) };
}

describe.skipIf(!ENABLED)("event venue (integration)", () => {
  const run = Date.now();
  let organizer: Awaited<ReturnType<typeof makeUser>>;
  let seriesId: string;
  let trackId: string;
  let fullCourseId: string;
  let clubCourseId: string;

  beforeAll(async () => {
    organizer = await makeUser(`venueorg_${run}`);

    // A directory track with two configurations, exactly as the seed ships
    // them — the case where picking the wrong one is a wasted weekend.
    await seedReferenceTracks(db, [
      {
        name: `Venue Park ${run}`,
        kind: TrackKind.CIRCUIT,
        city: "Elkhart Lake",
        state: "ZW",
        layouts: [
          {
            name: "Full Course",
            lengthMeters: 6515,
            turnCount: 14,
            direction: TrackDirection.CLOCKWISE,
            isPrimary: true,
          },
          { name: "Club Course", lengthMeters: 3200, turnCount: 9 },
        ],
      },
    ]);
    const track = await db.track.findFirstOrThrow({
      where: { region: "ZW" },
      include: { layouts: { orderBy: { name: "asc" } } },
    });
    trackId = track.id;
    clubCourseId = track.layouts.find((l) => l.name === "Club Course")!.id;
    fullCourseId = track.layouts.find((l) => l.name === "Full Course")!.id;

    const series = await organizer.caller.series.create({
      name: `Venue Cup ${run}`,
      discipline: SeriesDiscipline.REAL_WORLD,
      platform: "Circuit",
    });
    seriesId = series.id;
  });

  afterAll(async () => {
    if (!ENABLED) return;
    await db.raceEvent.deleteMany({ where: { seriesId } });
    await db.series.deleteMany({ where: { id: seriesId } });
    await db.track.deleteMany({ where: { region: "ZW" } });
    await db.user.deleteMany({ where: { id: organizer.user.id } });
    await db.$disconnect();
  });

  it("links a directory layout at the moment the event is created", async () => {
    // Previously the only way to set a venue while creating an event was a
    // free-text box, and linking a track was a separate step on another page
    // that most organizers never reached.
    const event = await organizer.caller.event.create({
      seriesId,
      name: "Round 1",
      date: new Date(Date.UTC(2026, 8, 1, 9, 0)),
      platform: "Circuit",
      trackLayoutId: fullCourseId,
    });

    const loaded = await organizer.caller.event.byId({ eventId: event.id });
    expect(loaded.trackLayout?.id).toBe(fullCourseId);
    expect(loaded.trackLayout?.track.name).toContain("Venue Park");
  });

  it("serves the figures the event page shows, not just a name", async () => {
    const event = await organizer.caller.event.create({
      seriesId,
      name: "Round 2",
      date: new Date(Date.UTC(2026, 8, 8, 9, 0)),
      platform: "Circuit",
      trackLayoutId: fullCourseId,
    });
    const loaded = await organizer.caller.event.byId({ eventId: event.id });

    expect(loaded.trackLayout?.lengthMeters).toBe(6515);
    expect(loaded.trackLayout?.turnCount).toBe(14);
    expect(loaded.trackLayout?.direction).toBe(TrackDirection.CLOCKWISE);
    expect(loaded.trackLayout?.track.city).toBe("Elkhart Lake");
  });

  it("carries the circuit's other layouts, so the chosen one is legible", async () => {
    /*
     * "Full Course" on its own is an unexplained label. Listed beside the club
     * course it is visibly one of two, which is what stops somebody turning up
     * having practised the wrong configuration.
     */
    const event = await organizer.caller.event.create({
      seriesId,
      name: "Round 3",
      date: new Date(Date.UTC(2026, 8, 15, 9, 0)),
      platform: "Circuit",
      trackLayoutId: clubCourseId,
    });
    const loaded = await organizer.caller.event.byId({ eventId: event.id });

    const siblings = loaded.trackLayout!.track.layouts;
    expect(siblings).toHaveLength(2);
    expect(siblings.map((l) => l.name).sort()).toEqual([
      "Club Course",
      "Full Course",
    ]);
    // Each sibling carries enough to render its own line without another call.
    const full = siblings.find((l) => l.name === "Full Course")!;
    expect(full.lengthMeters).toBe(6515);
    expect(full.turnCount).toBe(14);
  });

  it("carries the track's photos, so the event page can show the map", async () => {
    await organizer.caller.track.addImage({
      trackId,
      layoutId: fullCourseId,
      kind: TrackImageKind.MAP,
      url: `https://example.test/venue-${run}.png`,
      credit: "The circuit",
    });

    const event = await organizer.caller.event.create({
      seriesId,
      name: "Round 4",
      date: new Date(Date.UTC(2026, 8, 22, 9, 0)),
      platform: "Circuit",
      trackLayoutId: fullCourseId,
    });
    const loaded = await organizer.caller.event.byId({ eventId: event.id });

    const images = loaded.trackLayout!.track.images;
    expect(images.length).toBeGreaterThan(0);
    // The same picker the track page uses resolves the same map here.
    expect(primaryImage(images, fullCourseId)?.credit).toBe("The circuit");
    // And a layout with no picture of its own still gets none, rather than
    // borrowing another configuration's map.
    expect(primaryImage(images, clubCourseId)).toBeNull();
  });

  it("still accepts a typed venue for somewhere with no track record", async () => {
    // A hillclimb on someone's estate has no Track row and does not need one.
    const event = await organizer.caller.event.create({
      seriesId,
      name: "Round 5",
      date: new Date(Date.UTC(2026, 8, 29, 9, 0)),
      platform: "Hillclimb",
      venue: "Shelsley Walsh",
    });
    const loaded = await organizer.caller.event.byId({ eventId: event.id });
    expect(loaded.venue).toBe("Shelsley Walsh");
    expect(loaded.trackLayout).toBeNull();
  });

  it("lets an organizer change the layout without recreating the event", async () => {
    const event = await organizer.caller.event.create({
      seriesId,
      name: "Round 6",
      date: new Date(Date.UTC(2026, 9, 6, 9, 0)),
      platform: "Circuit",
      trackLayoutId: fullCourseId,
    });
    await organizer.caller.event.update({
      eventId: event.id,
      trackLayoutId: clubCourseId,
    });
    const moved = await organizer.caller.event.byId({ eventId: event.id });
    expect(moved.trackLayout?.id).toBe(clubCourseId);

    // And unlink back to nothing, for a venue that turns out not to be listed.
    await organizer.caller.event.update({
      eventId: event.id,
      trackLayoutId: null,
    });
    const unlinked = await organizer.caller.event.byId({ eventId: event.id });
    expect(unlinked.trackLayout).toBeNull();
  });

  it("will not let a venue be deleted out from under a scheduled event", async () => {
    /*
     * Linking an event to the directory has to be safe in both directions.
     * Deleting the track would detach the meeting, its entries and its results
     * from the place they happened, so the track router refuses — and says
     * what to do instead. Marking a layout inactive is the supported way to
     * retire it without breaking history.
     */
    const doomedTrack = await organizer.caller.track.create({
      name: `Doomed Venue ${run}`,
      country: "us",
      region: "ZW",
      firstLayoutName: "Course",
    });
    const layoutId = doomedTrack.layouts[0].id;
    await organizer.caller.event.create({
      seriesId,
      name: "Round 7",
      date: new Date(Date.UTC(2026, 9, 13, 9, 0)),
      platform: "Circuit",
      trackLayoutId: layoutId,
    });

    await expect(
      organizer.caller.track.delete({ trackId: doomedTrack.id }),
    ).rejects.toThrow(/Tracks with history cannot be deleted/i);
    await expect(
      organizer.caller.track.deleteLayout({ layoutId }),
    ).rejects.toThrow(/Mark it inactive instead/i);

    // Inactive is the supported retirement: history intact, and the picker
    // stops offering it.
    await organizer.caller.track.updateLayout({ layoutId, active: false });
    const offered = await organizer.caller.track.list({
      query: `Doomed Venue ${run}`,
      limit: 5,
    });
    expect(offered.items[0]?.layouts).toEqual([]);
  });

  it("offers the directory to the picker, filtered by state", async () => {
    // The picker is a `track.list` query; this is the query it makes.
    const byRegion = await organizer.caller.track.list({
      region: "ZW",
      limit: 20,
    });
    expect(byRegion.items.map((t) => t.name)).toContain(`Venue Park ${run}`);
    // And each row carries the layouts the picker turns into buttons.
    const park = byRegion.items.find((t) => t.name === `Venue Park ${run}`)!;
    expect(park.layouts.map((l) => l.name).sort()).toEqual([
      "Club Course",
      "Full Course",
    ]);
  });
});
