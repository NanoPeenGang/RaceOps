import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PlatformRole,
  PrismaClient,
  SeriesDiscipline,
  SeriesRole,
  SessionType,
} from "@prisma/client";
import { createCaller } from "@/server/trpc/root";
import { groupSessionsByDay } from "@/lib/schedule";
import { sortTimingRows } from "@/lib/timing";

/** Multi-day schedules and live timing end-to-end. Opt in with RUN_DB_TESTS=1. */
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

const anon = () => callerFor(null);

/** Local-midnight-anchored day, so grouping assertions are timezone-stable. */
function at(dayOffset: number, hour: number) {
  const date = new Date();
  date.setDate(date.getDate() + dayOffset);
  date.setHours(hour, 0, 0, 0);
  return date;
}

describe.skipIf(!ENABLED)("schedule & live timing (integration)", () => {
  const run = Date.now();
  let owner: Awaited<ReturnType<typeof makeUser>>;
  let steward: Awaited<ReturnType<typeof makeUser>>;
  let outsider: Awaited<ReturnType<typeof makeUser>>;
  let racers: Awaited<ReturnType<typeof makeUser>>[] = [];
  let seriesId: string;
  let eventId: string;
  let otherEventId: string;
  let registrationIds: string[] = [];

  beforeAll(async () => {
    owner = await makeUser(`stowner_${run}`);
    steward = await makeUser(`ststew_${run}`);
    outsider = await makeUser(`stout_${run}`);
    racers = await Promise.all([
      makeUser(`stra_${run}`),
      makeUser(`strb_${run}`),
    ]);

    const series = await owner.caller.series.create({
      name: `Timing Cup ${run}`,
      discipline: SeriesDiscipline.REAL_WORLD,
      platform: "Club circuit",
    });
    seriesId = series.id;
    await owner.caller.series.setOrganizer({
      seriesId,
      userId: steward.user.id,
      role: SeriesRole.STEWARD,
    });

    const event = await owner.caller.event.create({
      seriesId,
      name: "Timing Round",
      date: at(1, 9),
      platform: "Club circuit",
    });
    eventId = event.id;
    await owner.caller.event.setStatus({ eventId, status: "PUBLISHED" });

    const other = await owner.caller.event.create({
      seriesId,
      name: "Other Round",
      date: at(30, 9),
      platform: "Club circuit",
    });
    otherEventId = other.id;
    await owner.caller.event.setStatus({
      eventId: otherEventId,
      status: "PUBLISHED",
    });

    registrationIds = [];
    for (const [index, racer] of racers.entries()) {
      const registration = await racer.caller.event.register({
        eventId,
        carNumber: String(10 + index),
      });
      await owner.caller.event.setRegistrationStatus({
        registrationId: registration.id,
        status: "CONFIRMED",
      });
      registrationIds.push(registration.id);
    }
  });

  afterAll(async () => {
    if (!ENABLED) return;
    await db.series.deleteMany({ where: { id: seriesId } });
    await db.user.deleteMany({
      where: {
        authProviderId: {
          in: [owner, steward, outsider, ...racers].map(
            (u) => u.user.authProviderId!,
          ),
        },
      },
    });
    await db.$disconnect();
  });

  // -------------------------------------------------------------------------
  // Schedule
  // -------------------------------------------------------------------------

  it("lays out a multi-day running order that groups by day", async () => {
    await owner.caller.session.create({
      eventId,
      type: SessionType.SCRUTINEERING,
      name: "Scrutineering",
      startsAt: at(1, 9),
      endsAt: at(1, 12),
    });
    await owner.caller.session.create({
      eventId,
      type: SessionType.PRACTICE,
      name: "Free Practice",
      startsAt: at(2, 10),
      endsAt: at(2, 11),
    });
    await owner.caller.session.create({
      eventId,
      type: SessionType.RACE,
      name: "Feature Race",
      startsAt: at(3, 14),
      endsAt: at(3, 16),
    });

    const sessions = await anon().session.forEvent({ eventId });
    expect(sessions).toHaveLength(3);
    // Public and ordered — an entrant reads the weekend without signing in.
    expect(sessions.map((s) => s.name)).toEqual([
      "Scrutineering",
      "Free Practice",
      "Feature Race",
    ]);
    expect(groupSessionsByDay(sessions)).toHaveLength(3);
  });

  it("refuses a session that ends before it starts", async () => {
    await expect(
      owner.caller.session.create({
        eventId,
        type: SessionType.PRACTICE,
        name: "Backwards",
        startsAt: at(2, 15),
        endsAt: at(2, 14),
      }),
    ).rejects.toThrow(/start before it ends/i);
  });

  it("keeps the start-before-end rule on update", async () => {
    const created = await owner.caller.session.create({
      eventId,
      type: SessionType.WARMUP,
      name: "Warm-up",
      startsAt: at(3, 12),
      endsAt: at(3, 13),
    });
    await expect(
      owner.caller.session.update({
        sessionId: created.id,
        startsAt: at(3, 14),
      }),
    ).rejects.toThrow(/start before it ends/i);

    const renamed = await owner.caller.session.update({
      sessionId: created.id,
      name: "Sunday warm-up",
    });
    expect(renamed.name).toBe("Sunday warm-up");
    await owner.caller.session.delete({ sessionId: created.id });
  });

  it("does not let a non-organizer touch the schedule", async () => {
    await expect(
      outsider.caller.session.create({
        eventId,
        type: SessionType.PRACTICE,
        name: "Sneaky session",
        startsAt: at(2, 8),
        endsAt: at(2, 9),
      }),
    ).rejects.toThrow(/permission/i);

    // A steward runs penalties, not the running order.
    await expect(
      steward.caller.session.create({
        eventId,
        type: SessionType.PRACTICE,
        name: "Steward session",
        startsAt: at(2, 8),
        endsAt: at(2, 9),
      }),
    ).rejects.toThrow(/permission/i);
  });

  // -------------------------------------------------------------------------
  // Live timing
  // -------------------------------------------------------------------------

  it("seeds the board from confirmed entries and runs the flags", async () => {
    const sessions = await anon().session.forEvent({ eventId });
    const race = sessions.find((s) => s.name === "Feature Race")!;

    const seeded = await owner.caller.session.seedTiming({
      sessionId: race.id,
    });
    expect(seeded.seeded).toBe(registrationIds.length);

    // Seeding twice must not duplicate rows.
    await owner.caller.session.seedTiming({ sessionId: race.id });
    const board = await anon().session.timing({ sessionId: race.id });
    expect(board.entries).toHaveLength(registrationIds.length);

    const live = await owner.caller.session.setLiveState({
      sessionId: race.id,
      status: "LIVE",
      flagState: "GREEN",
    });
    expect(live.status).toBe("LIVE");
    expect(live.flagState).toBe("GREEN");

    const running = await anon().session.liveNow();
    expect(running.map((s) => s.id)).toContain(race.id);
  });

  it("pushes timing and only lowers a best lap when it is quicker", async () => {
    const sessions = await anon().session.forEvent({ eventId });
    const race = sessions.find((s) => s.name === "Feature Race")!;

    await owner.caller.session.pushTiming({
      sessionId: race.id,
      registrationId: registrationIds[0],
      position: 1,
      lapsCompleted: 10,
      lastLap: "1:28.500",
    });
    let entry = await db.timingEntry.findFirstOrThrow({
      where: { sessionId: race.id, registrationId: registrationIds[0] },
    });
    expect(entry.bestLapMs).toBe(88_500);

    // A slower lap must not overwrite the personal best.
    await owner.caller.session.pushTiming({
      sessionId: race.id,
      registrationId: registrationIds[0],
      position: 1,
      lapsCompleted: 11,
      lastLap: "1:31.000",
    });
    entry = await db.timingEntry.findFirstOrThrow({
      where: { sessionId: race.id, registrationId: registrationIds[0] },
    });
    expect(entry.lastLapMs).toBe(91_000);
    expect(entry.bestLapMs).toBe(88_500);

    // A quicker one does.
    await owner.caller.session.pushTiming({
      sessionId: race.id,
      registrationId: registrationIds[0],
      position: 1,
      lapsCompleted: 12,
      lastLap: "1:27.100",
    });
    entry = await db.timingEntry.findFirstOrThrow({
      where: { sessionId: race.id, registrationId: registrationIds[0] },
    });
    expect(entry.bestLapMs).toBe(87_100);
  });

  it("orders the public board and labels competitors", async () => {
    const sessions = await anon().session.forEvent({ eventId });
    const race = sessions.find((s) => s.name === "Feature Race")!;

    await owner.caller.session.pushTiming({
      sessionId: race.id,
      registrationId: registrationIds[1],
      position: 2,
      lapsCompleted: 12,
      lastLap: "1:29.900",
      gapSeconds: 4.25,
    });

    const board = await anon().session.timing({ sessionId: race.id });
    const ordered = sortTimingRows(board.entries);
    expect(ordered[0].registrationId).toBe(registrationIds[0]);
    expect(ordered[1].gapMs).toBe(4250);
    expect(ordered[0].competitorLabel).not.toBe("Entry");
  });

  it("rejects a lap time it cannot read", async () => {
    const sessions = await anon().session.forEvent({ eventId });
    const race = sessions.find((s) => s.name === "Feature Race")!;
    await expect(
      owner.caller.session.pushTiming({
        sessionId: race.id,
        registrationId: registrationIds[0],
        lastLap: "about a minute",
      }),
    ).rejects.toThrow(/could not read/i);
  });

  it("refuses an entry from another event", async () => {
    const sessions = await anon().session.forEvent({ eventId });
    const race = sessions.find((s) => s.name === "Feature Race")!;

    const foreign = await racers[0].caller.event.register({
      eventId: otherEventId,
      carNumber: "99",
    });
    await expect(
      owner.caller.session.pushTiming({
        sessionId: race.id,
        registrationId: foreign.id,
      }),
    ).rejects.toThrow(/not part of this event/i);
  });

  it("does not let an outsider push timing", async () => {
    const sessions = await anon().session.forEvent({ eventId });
    const race = sessions.find((s) => s.name === "Feature Race")!;
    await expect(
      outsider.caller.session.pushTiming({
        sessionId: race.id,
        registrationId: registrationIds[0],
        position: 1,
      }),
    ).rejects.toThrow(/permission/i);
  });

  it("cascades timing rows when a session is deleted", async () => {
    const created = await owner.caller.session.create({
      eventId,
      type: SessionType.QUALIFYING,
      name: "Qualifying",
      startsAt: at(2, 13),
      endsAt: at(2, 14),
    });
    await owner.caller.session.seedTiming({ sessionId: created.id });
    expect(
      await db.timingEntry.count({ where: { sessionId: created.id } }),
    ).toBeGreaterThan(0);

    await owner.caller.session.delete({ sessionId: created.id });
    expect(
      await db.timingEntry.count({ where: { sessionId: created.id } }),
    ).toBe(0);
  });
});
