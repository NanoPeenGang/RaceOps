import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  EventStatus,
  PlatformRole,
  PrismaClient,
  SeriesDiscipline,
  SessionStatus,
  SessionType,
  TrackState,
  WeatherKind,
} from "@prisma/client";
import { createCaller } from "@/server/trpc/root";

/** Tracks, layouts, corner-referenced incidents and lap records. */
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

describe.skipIf(!ENABLED)("tracks (integration)", () => {
  const run = Date.now();
  let curator: Awaited<ReturnType<typeof makeUser>>;
  let outsider: Awaited<ReturnType<typeof makeUser>>;
  let entrant: Awaited<ReturnType<typeof makeUser>>;
  let trackId: string;
  let trackSlug: string;
  let layoutId: string;
  let seriesId: string;
  let eventId: string;
  let registrationId: string;

  beforeAll(async () => {
    curator = await makeUser(`trkcur_${run}`);
    outsider = await makeUser(`trkout_${run}`);
    entrant = await makeUser(`trkent_${run}`);

    const track = await curator.caller.track.create({
      name: `Test Circuit ${run}`,
      country: "be",
      city: "Stavelot",
      licenceGrade: "Club",
      pitBoxCount: 24,
      firstLayoutName: "Grand Prix",
    });
    trackId = track.id;
    trackSlug = track.slug;
    layoutId = track.layouts[0].id;

    const series = await curator.caller.series.create({
      name: `Track Cup ${run}`,
      discipline: SeriesDiscipline.REAL_WORLD,
      platform: "Circuit",
    });
    seriesId = series.id;

    const event = await curator.caller.event.create({
      seriesId,
      name: "Round 1",
      date: new Date(Date.now() + 864e5),
      platform: "Circuit",
      trackLayoutId: layoutId,
    });
    eventId = event.id;
    await curator.caller.event.setStatus({
      eventId,
      status: EventStatus.PUBLISHED,
    });

    const registration = await entrant.caller.event.register({
      eventId,
      carNumber: "7",
    });
    registrationId = registration.id;
    await curator.caller.event.setRegistrationStatus({
      registrationId,
      status: "CONFIRMED",
    });
  });

  afterAll(async () => {
    if (ENABLED) await db.$disconnect();
  });

  it("normalizes the country and creates a primary first layout", async () => {
    const track = await curator.caller.track.bySlug({ slug: trackSlug });
    expect(track.country).toBe("BE");
    expect(track.layouts).toHaveLength(1);
    expect(track.layouts[0].isPrimary).toBe(true);
  });

  it("lets only the curator edit the track", async () => {
    await expect(
      outsider.caller.track.update({ trackId, notes: "vandalism" }),
    ).rejects.toThrow(/permission|Only the person/i);

    await curator.caller.track.update({ trackId, notes: "Steep pit entry." });
    const track = await curator.caller.track.byId({ trackId });
    expect(track.notes).toBe("Steep pit entry.");
  });

  it("keeps at most one primary layout per track", async () => {
    const second = await curator.caller.track.addLayout({
      trackId,
      name: "Endurance",
      lengthMeters: 7004,
    });
    expect(second.isPrimary).toBe(false);

    await curator.caller.track.setPrimaryLayout({ layoutId: second.id });
    const track = await curator.caller.track.byId({ trackId });
    expect(track.layouts.filter((layout) => layout.isPrimary)).toHaveLength(1);
    expect(track.layouts.find((layout) => layout.isPrimary)?.id).toBe(
      second.id,
    );

    // Put it back so the rest of the suite reads the layout it expects.
    await curator.caller.track.setPrimaryLayout({ layoutId });
  });

  it("rejects duplicate corner numbers", async () => {
    await expect(
      curator.caller.track.setTurns({
        layoutId,
        turns: [{ number: 1 }, { number: 1, name: "again" }],
      }),
    ).rejects.toThrow(/share a number/i);
  });

  it("keeps incident references when corners are re-saved", async () => {
    const turns = await curator.caller.track.setTurns({
      layoutId,
      turns: [
        { number: 1, name: "La Source", sector: 1, marshalPost: "Post 1" },
        { number: 2, name: "Eau Rouge", sector: 1 },
        { number: 3, name: "Les Combes", sector: 2 },
      ],
    });
    expect(turns).toHaveLength(3);

    const eauRouge = turns.find((turn) => turn.number === 2)!;
    const incident = await curator.caller.incident.file({
      eventId,
      subjectRegistrationId: registrationId,
      source: "RACE_CONTROL",
      summary: "Left the track and gained an advantage",
      lapNumber: 4,
      turnId: eauRouge.id,
    });
    expect(incident.turn?.name).toBe("Eau Rouge");

    // Renaming a corner and dropping another must not detach the report.
    await curator.caller.track.setTurns({
      layoutId,
      turns: [
        { number: 1, name: "La Source", sector: 1 },
        { number: 2, name: "Raidillon", sector: 1 },
      ],
    });
    const after = await curator.caller.incident.byId({
      incidentId: incident.id,
    });
    expect(after.turn?.id).toBe(eauRouge.id);
    expect(after.turn?.name).toBe("Raidillon");
  });

  it("refuses a corner that belongs to another circuit", async () => {
    const other = await curator.caller.track.create({
      name: `Other Circuit ${run}`,
      firstLayoutName: "Full",
    });
    const [foreign] = await curator.caller.track.setTurns({
      layoutId: other.layouts[0].id,
      turns: [{ number: 1, name: "Somewhere else" }],
    });

    await expect(
      curator.caller.incident.file({
        eventId,
        source: "RACE_CONTROL",
        summary: "Corner from the wrong track",
        turnId: foreign.id,
      }),
    ).rejects.toThrow(/not on this event/i);
  });

  it("refuses to delete a track with event history", async () => {
    await expect(
      curator.caller.track.delete({ trackId }),
    ).rejects.toThrow(/cannot be deleted/i);

    await expect(
      curator.caller.track.deleteLayout({ layoutId }),
    ).rejects.toThrow(/Mark it inactive/i);
  });

  it("builds lap records only from finished sessions of completed events", async () => {
    const session = await curator.caller.session.create({
      eventId,
      type: SessionType.RACE,
      name: "Race",
      startsAt: new Date(Date.now() + 864e5),
      endsAt: new Date(Date.now() + 864e5 + 3_600_000),
    });
    await db.timingEntry.create({
      data: { sessionId: session.id, registrationId, bestLapMs: 132_456 },
    });

    // The event is still published and the session still scheduled.
    const early = await curator.caller.track.records({ layoutId });
    expect(early?.overall).toBeNull();

    await curator.caller.session.setLiveState({
      sessionId: session.id,
      status: SessionStatus.FINISHED,
    });
    await curator.caller.event.setStatus({
      eventId,
      status: EventStatus.COMPLETED,
    });

    const records = await curator.caller.track.records({ layoutId });
    expect(records?.overall?.lapMs).toBe(132_456);
    expect(records?.overall?.competitorLabel).toContain("#7");
    // No class was declared, so there is no per-class table.
    expect(records?.byClass).toEqual([]);
  });

  it("shows records to signed-out visitors", async () => {
    const records = await callerFor(null).track.records({ layoutId });
    expect(records?.overall?.lapMs).toBe(132_456);
  });

  it("excludes a wet session's laps from the dry record", async () => {
    const session = await db.eventSession.findFirstOrThrow({
      where: { eventId },
    });

    // With no conditions logged, dryOnly must not throw the lap out.
    const before = await curator.caller.track.records({
      layoutId,
      dryOnly: true,
    });
    expect(before?.overall?.lapMs).toBe(132_456);

    // The race started dry and turned. Any wet reading makes it a wet session.
    await curator.caller.session.logConditions({
      sessionId: session.id,
      trackState: TrackState.DRY,
      airTempC: 21,
      trackTempC: 34,
    });
    await curator.caller.session.logConditions({
      sessionId: session.id,
      trackState: TrackState.STANDING_WATER,
      weather: WeatherKind.HEAVY_RAIN,
    });

    const board = await curator.caller.session.timing({
      sessionId: session.id,
    });
    expect(board.wet).toBe(true);
    expect(board.currentConditions?.trackState).toBe(
      TrackState.STANDING_WATER,
    );

    const dry = await curator.caller.track.records({ layoutId, dryOnly: true });
    expect(dry?.overall).toBeNull();

    // The outright record still stands — wet or not, it was the fastest lap.
    const outright = await curator.caller.track.records({ layoutId });
    expect(outright?.overall?.lapMs).toBe(132_456);
    expect(outright?.overall?.wet).toBe(true);
  });

  it("keeps conditions logging to officials", async () => {
    const session = await db.eventSession.findFirstOrThrow({
      where: { eventId },
    });
    await expect(
      entrant.caller.session.logConditions({
        sessionId: session.id,
        trackState: TrackState.DRY,
      }),
    ).rejects.toThrow(/permission/i);
  });
});
