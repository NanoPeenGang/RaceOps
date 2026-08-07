import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  LineupRole,
  PlatformRole,
  PrismaClient,
  SeriesDiscipline,
  TeamRole,
} from "@prisma/client";
import { createCaller } from "@/server/trpc/root";

/** Endurance line-ups and drive time end-to-end. Opt in with RUN_DB_TESTS=1. */
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
const minutesAgo = (n: number) => new Date(Date.now() - n * 60000);

describe.skipIf(!ENABLED)("endurance line-ups (integration)", () => {
  const run = Date.now();
  let organizer: Awaited<ReturnType<typeof makeUser>>;
  let manager: Awaited<ReturnType<typeof makeUser>>;
  let driverA: Awaited<ReturnType<typeof makeUser>>;
  let driverB: Awaited<ReturnType<typeof makeUser>>;
  let driverC: Awaited<ReturnType<typeof makeUser>>;
  let outsider: Awaited<ReturnType<typeof makeUser>>;
  let seriesId: string;
  let eventId: string;
  let teamId: string;
  let registrationId: string;

  beforeAll(async () => {
    organizer = await makeUser(`luorg_${run}`);
    manager = await makeUser(`lumgr_${run}`);
    driverA = await makeUser(`luda_${run}`);
    driverB = await makeUser(`ludb_${run}`);
    driverC = await makeUser(`ludc_${run}`);
    outsider = await makeUser(`luout_${run}`);

    const team = await manager.caller.team.create({ name: `Enduro ${run}` });
    teamId = team.id;

    const series = await organizer.caller.series.create({
      name: `Enduro Cup ${run}`,
      discipline: SeriesDiscipline.REAL_WORLD,
      platform: "Circuit",
    });
    seriesId = series.id;

    const event = await organizer.caller.event.create({
      seriesId,
      name: "6 Hours",
      date: new Date(Date.now() + 864e5),
      platform: "Circuit",
    });
    eventId = event.id;
    await organizer.caller.event.setStatus({ eventId, status: "PUBLISHED" });

    const registration = await manager.caller.event.register({
      eventId,
      teamId,
      carNumber: "24",
      carClass: "GT3",
    });
    registrationId = registration.id;
    await organizer.caller.event.setRegistrationStatus({
      registrationId,
      status: "CONFIRMED",
    });
  });

  afterAll(async () => {
    if (!ENABLED) return;
    await db.series.deleteMany({ where: { id: seriesId } });
    await db.team.deleteMany({ where: { id: teamId } });
    await db.user.deleteMany({
      where: {
        authProviderId: {
          in: [organizer, manager, driverA, driverB, driverC, outsider].map(
            (u) => u.user.authProviderId!,
          ),
        },
      },
    });
    await db.$disconnect();
  });

  // -------------------------------------------------------------------------
  // Rules
  // -------------------------------------------------------------------------

  it("has no line-up rules until an organizer sets them", async () => {
    const view = await anon().lineup.forRegistration({ registrationId });
    expect(view.rules.maxStintMinutes).toBeNull();
    expect(view.violations).toEqual([]);
  });

  it("rejects contradictory rules", async () => {
    await expect(
      organizer.caller.lineup.setRules({
        eventId,
        minDriversPerEntry: 4,
        maxDriversPerEntry: 2,
      }),
    ).rejects.toThrow(/cannot exceed the maximum/i);
    await expect(
      organizer.caller.lineup.setRules({
        eventId,
        minStintMinutes: 90,
        maxStintMinutes: 60,
      }),
    ).rejects.toThrow(/cannot exceed the maximum stint/i);
  });

  it("only lets organizers set the rules", async () => {
    await expect(
      manager.caller.lineup.setRules({ eventId, maxStintMinutes: 65 }),
    ).rejects.toThrow(/permission/i);

    await organizer.caller.lineup.setRules({
      eventId,
      minDriversPerEntry: 2,
      maxDriversPerEntry: 3,
      maxStintMinutes: 65,
      minStintMinutes: 15,
      maxDriveMinutesPerDriver: 150,
      minDriveMinutesPerDriver: 45,
    });
    const view = await anon().lineup.forRegistration({ registrationId });
    expect(view.rules.maxStintMinutes).toBe(65);
  });

  // -------------------------------------------------------------------------
  // Line-up
  // -------------------------------------------------------------------------

  it("flags an under-strength crew against the event's minimum", async () => {
    const view = await anon().lineup.forRegistration({ registrationId });
    expect(view.violations.map((v) => v.code)).toContain("TOO_FEW_DRIVERS");
  });

  it("lets the entrant declare a crew and race control see it", async () => {
    await manager.caller.lineup.addDriver({
      registrationId,
      userId: driverA.user.id,
      role: LineupRole.DRIVER_OF_RECORD,
      grade: "Pro",
    });
    await manager.caller.lineup.addDriver({
      registrationId,
      userId: driverB.user.id,
      grade: "Bronze",
    });

    const view = await anon().lineup.forRegistration({ registrationId });
    expect(view.lineup).toHaveLength(2);
    // Nothing is actually breached: each driver is still short of the minimum
    // drive time, but that is only outstanding until the race has run.
    expect(view.violations.filter((v) => v.severity === "breach")).toEqual([]);
    expect(
      view.violations.every((v) => v.code === "DRIVE_TIME_NOT_MET"),
    ).toBe(true);

    // The crew shows on the public entry list.
    const entries = await anon().lineup.forEvent({ eventId });
    const ours = entries.find((e) => e.id === registrationId)!;
    expect(ours.lineup).toHaveLength(2);
  });

  it("keeps only one driver of record", async () => {
    await manager.caller.lineup.addDriver({
      registrationId,
      userId: driverC.user.id,
      role: LineupRole.DRIVER_OF_RECORD,
    });
    const view = await anon().lineup.forRegistration({ registrationId });
    const ofRecord = view.lineup.filter(
      (entry) => entry.role === LineupRole.DRIVER_OF_RECORD,
    );
    // Nominating a new one demotes the previous rather than erroring.
    expect(ofRecord).toHaveLength(1);
    expect(ofRecord[0].userId).toBe(driverC.user.id);
  });

  it("refuses a duplicate driver on the same entry", async () => {
    await expect(
      manager.caller.lineup.addDriver({
        registrationId,
        userId: driverA.user.id,
      }),
    ).rejects.toThrow(/already on this entry/i);
  });

  it("flags a crew over the maximum", async () => {
    const extra = await makeUser(`luextra_${run}`);
    await manager.caller.lineup.addDriver({
      registrationId,
      userId: extra.user.id,
    });
    let view = await anon().lineup.forRegistration({ registrationId });
    expect(view.violations.map((v) => v.code)).toContain("TOO_MANY_DRIVERS");

    // A reserve does not occupy a seat, so re-roling clears the breach.
    const entry = view.lineup.find((e) => e.userId === extra.user.id)!;
    await manager.caller.lineup.setDriverRole({
      lineupDriverId: entry.id,
      role: LineupRole.RESERVE,
    });
    view = await anon().lineup.forRegistration({ registrationId });
    expect(view.violations.map((v) => v.code)).not.toContain(
      "TOO_MANY_DRIVERS",
    );

    await manager.caller.lineup.removeDriver({ lineupDriverId: entry.id });
    await db.user.delete({ where: { id: extra.user.id } });
  });

  it("does not let an outsider touch the line-up", async () => {
    await expect(
      outsider.caller.lineup.addDriver({
        registrationId,
        userId: outsider.user.id,
      }),
    ).rejects.toThrow(/entrant or race control/i);
  });

  it("lets race control manage the line-up too", async () => {
    const entry = await organizer.caller.lineup.addDriver({
      registrationId,
      userId: outsider.user.id,
      role: LineupRole.RESERVE,
    });
    await organizer.caller.lineup.removeDriver({ lineupDriverId: entry.id });
  });

  // -------------------------------------------------------------------------
  // Stints and drive time
  // -------------------------------------------------------------------------

  it("closes the open stint when the next driver gets in", async () => {
    const view = await anon().lineup.forRegistration({ registrationId });
    const [first, second] = view.lineup;

    await manager.caller.lineup.startStint({
      lineupDriverId: first.id,
      startedAt: minutesAgo(120),
    });
    await manager.caller.lineup.startStint({
      lineupDriverId: second.id,
      startedAt: minutesAgo(60),
    });

    const after = await anon().lineup.forRegistration({ registrationId });
    const open = after.stints.filter((stint) => stint.endedAt === null);
    // Only one driver can be in the car; the handover closes the previous stint.
    expect(open).toHaveLength(1);
    expect(open[0].lineupDriverId).toBe(second.id);
    expect(after.violations.map((v) => v.code)).not.toContain(
      "OVERLAPPING_STINTS",
    );
  });

  it("flags a stint over the event's maximum while it is still running", async () => {
    const view = await anon().lineup.forRegistration({ registrationId });
    // The open stint started 60 min ago and the limit is 65, so push it over.
    const open = view.stints.find((stint) => stint.endedAt === null)!;
    await db.stint.update({
      where: { id: open.id },
      data: { startedAt: minutesAgo(80) },
    });

    const after = await anon().lineup.forRegistration({ registrationId });
    expect(after.violations.map((v) => v.code)).toContain("STINT_TOO_LONG");
  });

  it("refuses a stint that ends before it starts", async () => {
    const view = await anon().lineup.forRegistration({ registrationId });
    const open = view.stints.find((stint) => stint.endedAt === null)!;
    await expect(
      manager.caller.lineup.endStint({
        stintId: open.id,
        endedAt: minutesAgo(600),
      }),
    ).rejects.toThrow(/cannot end before it started/i);
  });

  it("flags a driver over their total drive-time allowance", async () => {
    const view = await anon().lineup.forRegistration({ registrationId });
    const open = view.stints.find((stint) => stint.endedAt === null)!;
    await manager.caller.lineup.endStint({ stintId: open.id, laps: 30 });

    // Pile enough time onto one driver to pass the 150-minute cap.
    const target = view.lineup[0];
    await manager.caller.lineup.startStint({
      lineupDriverId: target.id,
      startedAt: minutesAgo(200),
    });
    const reopened = await anon().lineup.forRegistration({ registrationId });
    const latest = reopened.stints.find((stint) => stint.endedAt === null)!;
    await manager.caller.lineup.endStint({ stintId: latest.id });

    const after = await anon().lineup.forRegistration({ registrationId });
    const breach = after.violations.find(
      (v) => v.code === "DRIVE_TIME_EXCEEDED",
    );
    expect(breach?.lineupDriverId).toBe(target.id);
  });

  it("shows race control a compliance list for the whole event", async () => {
    const rows = await organizer.caller.lineup.complianceForEvent({ eventId });
    const ours = rows.find((row) => row.registrationId === registrationId)!;
    expect(ours.carNumber).toBe("24");
    expect(ours.breachCount).toBeGreaterThan(0);

    // It is race control's working view, not a public record.
    await expect(
      manager.caller.lineup.complianceForEvent({ eventId }),
    ).rejects.toThrow(/permission/i);
  });

  it("keeps a stint on the record when its driver leaves the line-up", async () => {
    const view = await anon().lineup.forRegistration({ registrationId });
    const stintsBefore = view.stints.length;
    const target = view.lineup.find((entry) =>
      view.stints.some((stint) => stint.lineupDriverId === entry.id),
    )!;

    const result = await manager.caller.lineup.removeDriver({
      lineupDriverId: target.id,
    });
    expect(result.orphanedStints).toBeGreaterThan(0);

    const after = await anon().lineup.forRegistration({ registrationId });
    // The car's history survives; the time just can no longer be attributed.
    expect(after.stints).toHaveLength(stintsBefore);
    expect(
      after.stints.some((stint) => stint.lineupDriverId === null),
    ).toBe(true);
  });

  it("lets a team manager who did not submit the entry still manage it", async () => {
    const colleague = await makeUser(`lucol_${run}`);
    await colleague.caller.team.join({ teamId });
    await manager.caller.team.setMemberRole({
      teamId,
      userId: colleague.user.id,
      role: TeamRole.MANAGER,
    });

    const entry = await colleague.caller.lineup.addDriver({
      registrationId,
      userId: colleague.user.id,
      role: LineupRole.RESERVE,
    });
    expect(entry.registrationId).toBe(registrationId);

    await db.user.delete({ where: { id: colleague.user.id } });
  });
});
