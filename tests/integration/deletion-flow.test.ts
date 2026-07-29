import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PenaltyType,
  PrismaClient,
  SeriesDiscipline,
  SeriesRole,
  VolunteerRoleType,
} from "@prisma/client";
import { createCaller } from "@/server/trpc/root";

/**
 * Destructive-path checks. Opt in with RUN_DB_TESTS=1.
 * The critical property: deleting a series must not leave orphaned events
 * behind — an event with no series has no organizer chain, so nobody could
 * manage or remove it afterwards.
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

describe.skipIf(!ENABLED)("deletion (integration)", () => {
  const run = Date.now();
  let owner: Awaited<ReturnType<typeof makeUser>>;
  let raceControl: Awaited<ReturnType<typeof makeUser>>;
  let racer: Awaited<ReturnType<typeof makeUser>>;
  const createdUsers: string[] = [];

  beforeAll(async () => {
    owner = await makeUser(`downer_${run}`);
    raceControl = await makeUser(`drc_${run}`);
    racer = await makeUser(`dracer_${run}`);
    createdUsers.push(
      owner.user.authProviderId,
      raceControl.user.authProviderId,
      racer.user.authProviderId,
    );
  });

  afterAll(async () => {
    if (!ENABLED) return;
    await db.user.deleteMany({
      where: { authProviderId: { in: createdUsers } },
    });
    await db.$disconnect();
  });

  /** A series with one published event, an entry, a penalty and a shift. */
  async function seedSeries(label: string) {
    const series = await owner.caller.series.create({
      name: `${label} ${run}`,
      discipline: SeriesDiscipline.SIM,
      platform: "iRacing",
    });
    await owner.caller.series.setOrganizer({
      seriesId: series.id,
      userId: raceControl.user.id,
      role: SeriesRole.RACE_CONTROL,
    });
    const event = await owner.caller.event.create({
      seriesId: series.id,
      name: `${label} Round 1`,
      date: new Date(Date.now() + 864e5),
      platform: "iRacing",
    });
    await owner.caller.event.setStatus({
      eventId: event.id,
      status: "PUBLISHED",
    });
    const registration = await racer.caller.event.register({
      eventId: event.id,
      carNumber: "5",
    });
    await owner.caller.event.setRegistrationStatus({
      registrationId: registration.id,
      status: "CONFIRMED",
    });
    await owner.caller.penalty.issue({
      registrationId: registration.id,
      type: PenaltyType.WARNING,
      summary: "Track limits",
    });
    await owner.caller.event.createShift({
      eventId: event.id,
      role: VolunteerRoleType.MARSHAL,
      title: "Turn 1",
      startsAt: new Date(Date.now() + 864e5),
      endsAt: new Date(Date.now() + 864e5 + 3600e3),
      capacity: 2,
    });
    return { series, event, registrationId: registration.id };
  }

  it("reports the blast radius before deleting a series", async () => {
    const { series } = await seedSeries("Impact");
    const impact = await owner.caller.series.deletionImpact({
      seriesId: series.id,
    });
    expect(impact.events).toBe(1);
    expect(impact.registrations).toBe(1);
    expect(impact.penalties).toBe(1);
    expect(impact.volunteerShifts).toBe(1);
    await owner.caller.series.delete({
      seriesId: series.id,
      confirmName: series.name,
    });
  });

  it("refuses a series delete from a non-owner", async () => {
    const { series } = await seedSeries("NonOwner");
    await expect(
      raceControl.caller.series.delete({
        seriesId: series.id,
        confirmName: series.name,
      }),
    ).rejects.toThrow(/permission/i);
    await expect(
      racer.caller.series.deletionImpact({ seriesId: series.id }),
    ).rejects.toThrow(/permission/i);
    await owner.caller.series.delete({
      seriesId: series.id,
      confirmName: series.name,
    });
  });

  it("refuses a series delete when the typed name does not match", async () => {
    const { series } = await seedSeries("Mismatch");
    await expect(
      owner.caller.series.delete({
        seriesId: series.id,
        confirmName: "not the name",
      }),
    ).rejects.toThrow(/does not match/i);
    // Still present after the failed attempt.
    expect(
      await db.series.findUnique({ where: { id: series.id } }),
    ).not.toBeNull();
    await owner.caller.series.delete({
      seriesId: series.id,
      confirmName: series.name,
    });
  });

  it("removes events with the series instead of orphaning them", async () => {
    const { series, event, registrationId } = await seedSeries("Cascade");

    await owner.caller.series.delete({
      seriesId: series.id,
      confirmName: series.name,
    });

    // The event must be gone, not merely detached from its series.
    expect(await db.raceEvent.findUnique({ where: { id: event.id } })).toBeNull();
    expect(
      await db.raceEvent.count({ where: { seriesId: null, name: `Cascade Round 1 ${run}` } }),
    ).toBe(0);
    // Everything hanging off the event goes with it.
    expect(
      await db.eventRegistration.findUnique({ where: { id: registrationId } }),
    ).toBeNull();
    expect(await db.penalty.count({ where: { eventId: event.id } })).toBe(0);
    expect(
      await db.volunteerShift.count({ where: { eventId: event.id } }),
    ).toBe(0);
    expect(await db.series.findUnique({ where: { id: series.id } })).toBeNull();
  });

  it("lets an owner delete a single event and its dependents", async () => {
    const { series, event, registrationId } = await seedSeries("EventDelete");

    const impact = await owner.caller.event.deletionImpact({
      eventId: event.id,
    });
    expect(impact.registrations).toBe(1);
    expect(impact.penalties).toBe(1);

    await owner.caller.event.delete({
      eventId: event.id,
      confirmName: event.name,
    });

    expect(await db.raceEvent.findUnique({ where: { id: event.id } })).toBeNull();
    expect(
      await db.eventRegistration.findUnique({ where: { id: registrationId } }),
    ).toBeNull();
    // The series itself survives.
    expect(
      await db.series.findUnique({ where: { id: series.id } }),
    ).not.toBeNull();

    await owner.caller.series.delete({
      seriesId: series.id,
      confirmName: series.name,
    });
  });

  it("does not let race control delete an event", async () => {
    const { series, event } = await seedSeries("RCDelete");
    await expect(
      raceControl.caller.event.delete({
        eventId: event.id,
        confirmName: event.name,
      }),
    ).rejects.toThrow(/permission/i);
    // Race control can still run the event.
    await raceControl.caller.event.setStatus({
      eventId: event.id,
      status: "COMPLETED",
    });
    await owner.caller.series.delete({
      seriesId: series.id,
      confirmName: series.name,
    });
  });

  it("notifies affected entrants when their event is deleted", async () => {
    const { series, event } = await seedSeries("Notify");
    await owner.caller.event.delete({
      eventId: event.id,
      confirmName: event.name,
    });
    const notifications = await racer.caller.notification.list({});
    expect(
      notifications.items.some((n) => n.title.includes("Event deleted")),
    ).toBe(true);
    await owner.caller.series.delete({
      seriesId: series.id,
      confirmName: series.name,
    });
  });
});
