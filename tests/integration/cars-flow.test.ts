import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PlatformRole,
  PrismaClient,
  SeriesDiscipline,
  TeamRole,
  TireSetStatus,
} from "@prisma/client";
import { createCaller } from "@/server/trpc/root";

/** Cars, transponders and tire allocation end-to-end. */
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

describe.skipIf(!ENABLED)("cars & transponders (integration)", () => {
  const run = Date.now();
  let organizer: Awaited<ReturnType<typeof makeUser>>;
  let manager: Awaited<ReturnType<typeof makeUser>>;
  let outsider: Awaited<ReturnType<typeof makeUser>>;
  let rival: Awaited<ReturnType<typeof makeUser>>;
  let teamId: string;
  let eventId: string;
  let carId: string;
  let registrationId: string;
  let rivalRegistrationId: string;
  let transponderId: string;

  beforeAll(async () => {
    organizer = await makeUser(`carorg_${run}`);
    manager = await makeUser(`carmgr_${run}`);
    outsider = await makeUser(`carout_${run}`);
    rival = await makeUser(`carriv_${run}`);

    const team = await manager.caller.team.create({
      name: `Chassis Racing ${run}`,
    });
    teamId = team.id;

    const series = await organizer.caller.series.create({
      name: `Chassis Cup ${run}`,
      discipline: SeriesDiscipline.REAL_WORLD,
      platform: "Circuit",
    });
    const event = await organizer.caller.event.create({
      seriesId: series.id,
      name: "Round 1",
      date: new Date(Date.now() + 864e5),
      platform: "Circuit",
      tireSetAllowance: 2,
    });
    eventId = event.id;
    await organizer.caller.event.setStatus({ eventId, status: "PUBLISHED" });

    const registration = await manager.caller.event.register({
      eventId,
      teamId,
      carNumber: "7",
    });
    registrationId = registration.id;

    const rivalRegistration = await rival.caller.event.register({
      eventId,
      carNumber: "8",
    });
    rivalRegistrationId = rivalRegistration.id;
    for (const id of [registrationId, rivalRegistrationId]) {
      await organizer.caller.event.setRegistrationStatus({
        registrationId: id,
        status: "CONFIRMED",
      });
    }
  });

  afterAll(async () => {
    if (ENABLED) await db.$disconnect();
  });

  it("creates a team car with exactly one owner", async () => {
    const car = await manager.caller.car.create({
      teamId,
      name: "Car 7",
      make: "Porsche",
      model: "911 GT3 R",
      year: 2019,
      chassisNumber: `WP0ZZZ${run}`,
    });
    carId = car.id;
    expect(car.teamId).toBe(teamId);
    expect(car.ownerUserId).toBeNull();
  });

  it("refuses a car for a team the caller does not manage", async () => {
    await expect(
      outsider.caller.car.create({ teamId, name: "Not mine" }),
    ).rejects.toThrow(/owner or a manager/i);
  });

  it("creates a personal car when no team is given", async () => {
    const car = await outsider.caller.car.create({ name: "My track car" });
    expect(car.ownerUserId).toBe(outsider.user.id);
    expect(car.teamId).toBeNull();
  });

  it("puts the car on the entry and refuses someone else's chassis", async () => {
    await manager.caller.car.setEntryCar({ registrationId, carId });
    const entry = await manager.caller.car.forRegistration({ registrationId });
    expect(entry.car?.name).toBe("Car 7");

    await expect(
      rival.caller.car.setEntryCar({
        registrationId: rivalRegistrationId,
        carId,
      }),
    ).rejects.toThrow(/not your car|owner or a manager/i);
  });

  it("normalizes transponder numbers and refuses a duplicate unit", async () => {
    const unit = await manager.caller.car.registerTransponder({
      teamId,
      number: ` tr-${run % 100000} `,
      make: "MyLaps X2",
    });
    transponderId = unit.id;
    expect(unit.number).toBe(`TR${run % 100000}`);

    // The same physical unit registered twice, written differently.
    await expect(
      rival.caller.car.registerTransponder({ number: `tr ${run % 100000}` }),
    ).rejects.toThrow(/already registered/i);
  });

  it("fits a transponder and keeps one primary per entry", async () => {
    await manager.caller.car.assignTransponder({
      registrationId,
      transponderId,
    });
    const second = await manager.caller.car.registerTransponder({
      teamId,
      number: `backup-${run % 100000}`,
    });
    const assignments = await manager.caller.car.assignTransponder({
      registrationId,
      transponderId: second.id,
      isPrimary: true,
    });
    expect(assignments.filter((a) => a.isPrimary)).toHaveLength(1);
    expect(assignments.find((a) => a.isPrimary)?.transponderId).toBe(second.id);
  });

  it("refuses a unit already fitted to another entry at the same event", async () => {
    await expect(
      rival.caller.car.assignTransponder({
        registrationId: rivalRegistrationId,
        transponderId,
      }),
    ).rejects.toThrow(/already fitted to another entry/i);
  });

  it("maps transponders to entries for a timing feed, officials only", async () => {
    const map = await organizer.caller.car.transponderMap({ eventId });
    expect(map.entries.length).toBe(2);
    expect(
      map.entries.every((entry) => entry.registrationId === registrationId),
    ).toBe(true);
    // The rival entry has no transponder, so a feed cannot place it.
    expect(map.unassigned).toBe(1);

    await expect(
      manager.caller.car.transponderMap({ eventId }),
    ).rejects.toThrow(/permission/i);
  });

  it("counts tire sets against the allowance and ignores voided sets", async () => {
    const first = await organizer.caller.car.allocateTireSet({
      registrationId,
      identifier: `SET-A-${run}`,
      compound: "Medium",
    });
    await organizer.caller.car.allocateTireSet({
      registrationId,
      identifier: `SET-B-${run}`,
      compound: "Medium",
    });

    let allocation = await manager.caller.car.myTireAllocation({
      registrationId,
    });
    expect(allocation.allocation.used).toBe(2);
    expect(allocation.allocation.remaining).toBe(0);
    expect(allocation.allocation.overAllowance).toBe(false);

    // A third set puts the entry over.
    await organizer.caller.car.allocateTireSet({
      registrationId,
      identifier: `SET-C-${run}`,
    });
    allocation = await manager.caller.car.myTireAllocation({ registrationId });
    expect(allocation.allocation.overAllowance).toBe(true);

    // Voiding the mis-scanned first set puts them back inside it, and the
    // record of the void survives.
    await organizer.caller.car.setTireStatus({
      tireSetId: first.id,
      status: TireSetStatus.VOID,
      notes: "Mis-scanned at the bay",
    });
    allocation = await manager.caller.car.myTireAllocation({ registrationId });
    expect(allocation.allocation.used).toBe(2);
    expect(allocation.allocation.voided).toBe(1);
    expect(allocation.sets).toHaveLength(3);
  });

  it("refuses a duplicate set identifier at the same event", async () => {
    await expect(
      organizer.caller.car.allocateTireSet({
        registrationId: rivalRegistrationId,
        identifier: `SET-B-${run}`,
      }),
    ).rejects.toThrow(/already been issued/i);
  });

  it("keeps tire allocation to officials", async () => {
    await expect(
      manager.caller.car.allocateTireSet({
        registrationId,
        identifier: `SELF-SERVE-${run}`,
      }),
    ).rejects.toThrow(/permission/i);
  });

  it("refuses to delete a car with entry history", async () => {
    await expect(manager.caller.car.delete({ carId })).rejects.toThrow(
      /Mark it inactive/i,
    );
  });

  it("shows a car's race history to anyone", async () => {
    const car = await callerFor(null).car.byId({ carId });
    expect(car.registrations).toHaveLength(1);
    expect(car.registrations[0].event.id).toBe(eventId);
  });

  it("keeps a driver on the roster from managing the team's cars", async () => {
    await db.teamMembership.create({
      data: { teamId, userId: rival.user.id, role: TeamRole.DRIVER },
    });
    await expect(
      rival.caller.car.update({ carId, name: "Renamed" }),
    ).rejects.toThrow(/owner or a manager/i);
  });
});
