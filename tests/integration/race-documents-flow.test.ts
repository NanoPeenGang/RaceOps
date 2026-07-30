import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient, SeriesDiscipline, SessionType } from "@prisma/client";
import { createCaller } from "@/server/trpc/root";

/** Generated documents assembled from real entries and sessions. */
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

describe.skipIf(!ENABLED)("generated documents (integration)", () => {
  const run = Date.now();
  let organizer: Awaited<ReturnType<typeof makeUser>>;
  let fast: Awaited<ReturnType<typeof makeUser>>;
  let slow: Awaited<ReturnType<typeof makeUser>>;
  let noTime: Awaited<ReturnType<typeof makeUser>>;
  let eventId: string;
  let qualifyingId: string;
  const registrations: Record<string, string> = {};

  beforeAll(async () => {
    organizer = await makeUser(`docorg_${run}`);
    fast = await makeUser(`docfast_${run}`);
    slow = await makeUser(`docslow_${run}`);
    noTime = await makeUser(`docnone_${run}`);

    const series = await organizer.caller.series.create({
      name: `Document Cup ${run}`,
      discipline: SeriesDiscipline.REAL_WORLD,
      platform: "Circuit",
    });
    const event = await organizer.caller.event.create({
      seriesId: series.id,
      name: "Round 1",
      date: new Date(Date.UTC(2026, 5, 1, 9, 0)),
      platform: "Circuit",
    });
    eventId = event.id;
    await organizer.caller.event.setStatus({ eventId, status: "PUBLISHED" });

    // Car numbers chosen so a lexical sort would get them wrong.
    for (const [key, user, number] of [
      ["fast", fast, "11"],
      ["slow", slow, "7"],
      ["noTime", noTime, "2"],
    ] as const) {
      const registration = await user.caller.event.register({
        eventId,
        carNumber: number,
      });
      registrations[key] = registration.id;
      await organizer.caller.event.setRegistrationStatus({
        registrationId: registration.id,
        status: "CONFIRMED",
      });
    }

    const qualifying = await organizer.caller.session.create({
      eventId,
      type: SessionType.QUALIFYING,
      name: "Qualifying",
      startsAt: new Date(Date.UTC(2026, 5, 1, 9, 0)),
      endsAt: new Date(Date.UTC(2026, 5, 1, 9, 45)),
    });
    qualifyingId = qualifying.id;
    await organizer.caller.session.create({
      eventId,
      type: SessionType.RACE,
      name: "Race",
      startsAt: new Date(Date.UTC(2026, 5, 2, 14, 0)),
      endsAt: new Date(Date.UTC(2026, 5, 2, 15, 0)),
    });

    await db.timingEntry.createMany({
      data: [
        {
          sessionId: qualifyingId,
          registrationId: registrations.fast,
          bestLapMs: 90_000,
        },
        {
          sessionId: qualifyingId,
          registrationId: registrations.slow,
          bestLapMs: 95_000,
        },
        {
          sessionId: qualifyingId,
          registrationId: registrations.noTime,
        },
      ],
    });
  });

  afterAll(async () => {
    if (ENABLED) await db.$disconnect();
  });

  it("builds the entry list in car-number order, publicly", async () => {
    const document = await callerFor(null).document.entryList({ eventId });
    expect(document.rows.map((row) => row.carNumber)).toEqual(["2", "7", "11"]);
    expect(document.header.eventName).toBe("Round 1");
  });

  it("leaves a withdrawn entry off the list without anyone re-issuing it", async () => {
    // The point of a generated list: an uploaded PDF is wrong the moment
    // somebody withdraws, and nobody re-uploads it.
    const leaver = await makeUser(`docgone_${run}`);
    const registration = await leaver.caller.event.register({
      eventId,
      carNumber: "99",
    });
    await organizer.caller.event.setRegistrationStatus({
      registrationId: registration.id,
      status: "CONFIRMED",
    });
    expect(
      (await callerFor(null).document.entryList({ eventId })).rows.map(
        (row) => row.carNumber,
      ),
    ).toContain("99");

    await leaver.caller.event.withdrawRegistration({
      registrationId: registration.id,
    });
    expect(
      (await callerFor(null).document.entryList({ eventId })).rows.map(
        (row) => row.carNumber,
      ),
    ).not.toContain("99");
  });

  it("carries the car, transponder and garage onto the entry list", async () => {
    const car = await fast.caller.car.create({
      name: "Car 11",
      make: "Porsche",
      model: "911",
    });
    await fast.caller.car.setEntryCar({
      registrationId: registrations.fast,
      carId: car.id,
    });
    const transponder = await fast.caller.car.registerTransponder({
      number: `DOC-${run}`,
    });
    await fast.caller.car.assignTransponder({
      registrationId: registrations.fast,
      transponderId: transponder.id,
    });
    await organizer.caller.paddock.allocate({
      registrationId: registrations.fast,
      garage: "Garage 3",
    });

    const document = await callerFor(null).document.entryList({ eventId });
    const row = document.rows.find((r) => r.carNumber === "11")!;
    expect(row.car).toBe("Porsche 911");
    expect(row.transponder).toBe(`DOC${run}`);
    expect(row.garage).toBe("Garage 3");
  });

  it("builds the timetable in running order", async () => {
    const document = await callerFor(null).document.timetable({ eventId });
    expect(document.rows.map((row) => row.name)).toEqual([
      "Qualifying",
      "Race",
    ]);
    expect(document.rows[0].durationMinutes).toBe(45);
  });

  it("grids from qualifying, with untimed cars at the back", async () => {
    const document = await callerFor(null).document.gridSheet({ eventId });
    expect(document.session?.name).toBe("Qualifying");
    expect(document.rows.map((row) => row.carNumber)).toEqual(["11", "7", "2"]);
    expect(document.rows[0].qualifyingTime).toBe("1:30.000");
    expect(document.rows[2].qualifyingTime).toBeNull();
    expect(document.rows[0]).toMatchObject({ gridRow: 1, side: "left" });
    expect(document.rows[2]).toMatchObject({ gridRow: 2, side: "left" });
  });

  it("grids wider when a series forms up three abreast", async () => {
    const document = await callerFor(null).document.gridSheet({
      eventId,
      carsPerRow: 3,
    });
    expect(document.rows.every((row) => row.gridRow === 1)).toBe(true);
  });

  it("returns a blank timing sheet before a session is timed", async () => {
    const race = await db.eventSession.findFirstOrThrow({
      where: { eventId, type: SessionType.RACE },
    });
    const document = await callerFor(null).document.timingSheet({
      eventId,
      sessionId: race.id,
    });
    expect(document.session?.name).toBe("Race");
    expect(document.rows).toHaveLength(3);
    expect(document.rows.every((row) => row.position === null)).toBe(true);
    // Blank sheets read by car number, which is how a hand-timing crew works.
    expect(document.rows.map((row) => row.carNumber)).toEqual(["2", "7", "11"]);
  });

  it("returns the classification once the session has been timed", async () => {
    const document = await callerFor(null).document.timingSheet({
      eventId,
      sessionId: qualifyingId,
    });
    // No positions were pushed, so it still reads by car number — but the
    // times that were recorded come through.
    const fastRow = document.rows.find((row) => row.carNumber === "11")!;
    expect(fastRow.bestLap).toBe("1:30.000");
  });

  it("404s for an event that does not exist", async () => {
    await expect(
      callerFor(null).document.entryList({
        eventId: "clxxxxxxxxxxxxxxxxxxxxxxx",
      }),
    ).rejects.toThrow();
  });
});
