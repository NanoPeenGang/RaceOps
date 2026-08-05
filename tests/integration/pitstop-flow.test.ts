import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PitStopKind,
  PitStopStatus,
  PrismaClient,
  SeriesDiscipline,
  SeriesRole,
  TeamRole,
} from "@prisma/client";
import { createCaller } from "@/server/trpc/root";

/**
 * Pit stop planning, end to end.
 *
 * The behaviours worth proving are the ones that only show up under a race:
 * the whole crew can edit the plan (not just the manager), an official can
 * watch it but not change it, renumbering does not fall over the unique index
 * halfway through, and a stop that already happened cannot be deleted out from
 * under the fuel numbers. Opt in with RUN_DB_TESTS=1.
 */
const ENABLED = process.env.RUN_DB_TESTS === "1";
const db = ENABLED ? new PrismaClient() : (null as unknown as PrismaClient);

function callerFor(clerkUserId: string) {
  return createCaller({ db, clerkUserId, headers: new Headers() });
}

describe.skipIf(!ENABLED)("pit stop plans (integration)", () => {
  const run = Date.now();
  let teamId: string;
  let eventId: string;
  let seriesId: string;
  let registrationId: string;
  let crew: ReturnType<typeof callerFor>;
  let official: ReturnType<typeof callerFor>;
  let outsider: ReturnType<typeof callerFor>;
  const userIds: string[] = [];

  async function makeUser(suffix: string) {
    const user = await db.user.create({
      data: {
        email: `${suffix}_${run}@example.test`,
        authProviderId: `clerk_${suffix}_${run}`,
        profile: { create: { displayName: suffix } },
      },
    });
    userIds.push(user.id);
    return { caller: callerFor(user.authProviderId), id: user.id };
  }

  beforeAll(async () => {
    if (!ENABLED) return;
    const team = await db.team.create({
      data: { name: `Pit Test ${run}`, slug: `pit-test-${run}` },
    });
    teamId = team.id;

    const series = await db.series.create({
      data: {
        name: `Pit Series ${run}`,
        slug: `pit-series-${run}`,
        discipline: SeriesDiscipline.REAL_WORLD,
        platform: "Circuit",
      },
    });
    seriesId = series.id;

    const event = await db.raceEvent.create({
      data: {
        name: `Pit Round ${run}`,
        seriesLabel: series.name,
        seriesId,
        platform: "Circuit",
        date: new Date("2026-05-01T00:00:00Z"),
      },
    });
    eventId = event.id;

    const owner = await makeUser("powner");
    const crewMember = await makeUser("pcrew");
    const officialUser = await makeUser("pofficial");
    const outsiderUser = await makeUser("poutsider");
    crew = crewMember.caller;
    official = officialUser.caller;
    outsider = outsiderUser.caller;

    await db.teamMembership.createMany({
      data: [
        { teamId, userId: owner.id, role: TeamRole.OWNER },
        // Deliberately CREW, not a manager: a plan edited in a pit box by
        // whoever has a free hand is the point.
        { teamId, userId: crewMember.id, role: TeamRole.CREW },
      ],
    });
    await db.seriesMembership.create({
      data: { seriesId, userId: officialUser.id, role: SeriesRole.RACE_CONTROL },
    });

    const registration = await db.eventRegistration.create({
      data: { eventId, teamId, submittedById: owner.id },
    });
    registrationId = registration.id;
  });

  afterAll(async () => {
    if (!ENABLED) return;
    await db.raceEvent.deleteMany({ where: { id: eventId } });
    await db.series.deleteMany({ where: { id: seriesId } });
    await db.team.deleteMany({ where: { id: teamId } });
    await db.user.deleteMany({ where: { id: { in: userIds } } });
    await db.$disconnect();
  });

  it("lets the whole active roster write the plan, not only managers", async () => {
    const stop = await crew.pitStop.add({
      registrationId,
      kind: PitStopKind.FUEL,
      targetLap: 30,
      plannedSeconds: 35,
    });
    expect(stop.sequence).toBe(1);
  });

  it("numbers stops on the server so two people cannot both claim one", async () => {
    await crew.pitStop.add({ registrationId, targetLap: 60 });
    const plan = await crew.pitStop.forEntry({ registrationId });
    expect(plan.stops.map((s) => s.sequence)).toEqual([1, 2]);
  });

  it("lets an official read the plan", async () => {
    const plan = await official.pitStop.forEntry({ registrationId });
    expect(plan.stops.length).toBe(2);
    expect(plan.canWrite).toBe(false);
  });

  it("does not let an official change it", async () => {
    // A team's stop strategy is theirs; an official editing it would be
    // changing a decision they do not own.
    await expect(
      official.pitStop.add({ registrationId, targetLap: 99 }),
    ).rejects.toThrow(/not change it/i);
  });

  it("keeps the plan away from everyone else entirely", async () => {
    await expect(
      outsider.pitStop.forEntry({ registrationId }),
    ).rejects.toThrow(/team running the entry/i);
  });

  it("reports the problems the plan has", async () => {
    const plan = await crew.pitStop.forEntry({ registrationId });
    expect(plan.problems.every((p) => p.code !== "OUT_OF_ORDER")).toBe(true);

    const second = plan.stops[1]!;
    await crew.pitStop.update({ stopId: second.id, targetLap: 10 });

    const after = await crew.pitStop.forEntry({ registrationId });
    expect(after.problems.map((p) => p.code)).toContain("OUT_OF_ORDER");

    await crew.pitStop.update({ stopId: second.id, targetLap: 60 });
  });

  it("points at the next stop, and stops pointing once it is done", async () => {
    let plan = await crew.pitStop.forEntry({ registrationId });
    expect(plan.next?.sequence).toBe(1);

    await crew.pitStop.complete({ stopId: plan.next!.id, actualSeconds: 51 });

    plan = await crew.pitStop.forEntry({ registrationId });
    expect(plan.next?.sequence).toBe(2);
    expect(plan.timing.completed).toBe(1);
    expect(plan.timing.bestSeconds).toBe(51);
    expect(plan.timing.deltaToPlanSeconds).toBe(16);
  });

  it("stamps the time when nobody supplies one", async () => {
    const plan = await crew.pitStop.forEntry({ registrationId });
    const stop = plan.stops.find(
      (s) => s.status === PitStopStatus.COMPLETED,
    )!;
    expect(stop.actualAt).not.toBeNull();
  });

  it("renumbers without falling over the unique index", async () => {
    // Swapping two stops hits the unique constraint halfway through unless the
    // rows are parked out of the way first — which would leave the plan
    // half-reordered, worse than refusing.
    const before = await crew.pitStop.forEntry({ registrationId });
    const reversed = [...before.stops].reverse().map((s) => s.id);

    await crew.pitStop.reorder({ registrationId, stopIds: reversed });

    const after = await crew.pitStop.forEntry({ registrationId });
    expect(after.stops.map((s) => s.id)).toEqual(reversed);
    expect(after.stops.map((s) => s.sequence)).toEqual([1, 2]);
  });

  it("refuses an ordering that does not match the plan", async () => {
    // A well-formed id belonging to nothing, so the check being exercised is
    // the membership one rather than zod's cuid format check.
    await expect(
      crew.pitStop.reorder({
        registrationId,
        stopIds: ["ckzzzzzzzzzzzzzzzzzzzzzzz"],
      }),
    ).rejects.toThrow(/does not match/i);
  });

  it("will not delete a stop that already happened", async () => {
    const plan = await crew.pitStop.forEntry({ registrationId });
    const completed = plan.stops.find(
      (s) => s.status === PitStopStatus.COMPLETED,
    )!;
    await expect(
      crew.pitStop.remove({ stopId: completed.id }),
    ).rejects.toThrow(/already happened/i);
  });

  it("deletes one that has not", async () => {
    const plan = await crew.pitStop.forEntry({ registrationId });
    const planned = plan.stops.find(
      (s) => s.status === PitStopStatus.PLANNED,
    )!;
    await expect(
      crew.pitStop.remove({ stopId: planned.id }),
    ).resolves.toEqual({ deleted: true });
  });
});
