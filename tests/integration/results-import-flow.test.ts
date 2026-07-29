import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient, SeriesDiscipline } from "@prisma/client";
import { createCaller } from "@/server/trpc/root";

/** Bulk results import end-to-end. Opt in with RUN_DB_TESTS=1. */
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

describe.skipIf(!ENABLED)("results import (integration)", () => {
  const run = Date.now();
  let owner: Awaited<ReturnType<typeof makeUser>>;
  let outsider: Awaited<ReturnType<typeof makeUser>>;
  let racers: Awaited<ReturnType<typeof makeUser>>[] = [];
  let seriesId: string;
  let eventId: string;

  beforeAll(async () => {
    owner = await makeUser(`iowner_${run}`);
    outsider = await makeUser(`iout_${run}`);
    racers = await Promise.all([
      makeUser(`ir1_${run}`),
      makeUser(`ir2_${run}`),
      makeUser(`ir3_${run}`),
    ]);

    const series = await owner.caller.series.create({
      name: `Import Cup ${run}`,
      discipline: SeriesDiscipline.SIM,
      platform: "iRacing",
    });
    seriesId = series.id;

    const event = await owner.caller.event.create({
      seriesId,
      name: "Import Round",
      date: new Date(Date.now() + 864e5),
      platform: "iRacing",
    });
    eventId = event.id;
    await owner.caller.event.setStatus({ eventId, status: "PUBLISHED" });

    const numbers = ["24", "7", "11"];
    for (let i = 0; i < racers.length; i++) {
      const registration = await racers[i].caller.event.register({
        eventId,
        carNumber: numbers[i],
      });
      await owner.caller.event.setRegistrationStatus({
        registrationId: registration.id,
        status: "CONFIRMED",
      });
    }
  });

  afterAll(async () => {
    if (!ENABLED) return;
    await db.series.deleteMany({ where: { id: seriesId } });
    await db.user.deleteMany({
      where: {
        authProviderId: {
          in: [
            owner.user.authProviderId,
            outsider.user.authProviderId,
            ...racers.map((r) => r.user.authProviderId),
          ],
        },
      },
    });
    await db.$disconnect();
  });

  const CSV = [
    "Pos,Car,Laps,Best Lap,Status,FL",
    "1,24,58,1:23.456,Finished,yes",
    "2,7,58,1:23.900,Finished,",
    "3,11,55,1:25.100,DNF,",
  ].join("\n");

  it("refuses the import to non-organizers", async () => {
    await expect(
      outsider.caller.event.importResults({ eventId, payload: CSV }),
    ).rejects.toThrow(/permission/i);
  });

  it("previews without writing anything", async () => {
    const plan = await owner.caller.event.previewResultsImport({
      eventId,
      payload: CSV,
    });
    expect(plan.matched).toHaveLength(3);
    expect(plan.conflicts).toEqual([]);
    expect(plan.unmatched).toEqual([]);
    // Dry run — nothing persisted yet.
    expect(await db.eventResult.count({ where: { eventId } })).toBe(0);
  });

  it("flags rows that match no confirmed entry", async () => {
    const plan = await owner.caller.event.previewResultsImport({
      eventId,
      payload: "Pos,Car\n1,24\n2,99",
    });
    expect(plan.matched).toHaveLength(1);
    expect(plan.unmatched[0].label).toBe("#99");
  });

  it("refuses to import while conflicts remain", async () => {
    await expect(
      owner.caller.event.importResults({
        eventId,
        payload: "Pos,Car\n1,24\n2,24",
      }),
    ).rejects.toThrow(/conflict/i);
  });

  it("imports the classification", async () => {
    const result = await owner.caller.event.importResults({
      eventId,
      payload: CSV,
    });
    expect(result.imported).toBe(3);

    const results = await owner.caller.event.resultsFor({ eventId });
    expect(results).toHaveLength(3);
    const winner = results.find((r) => r.finishPosition === 1)!;
    expect(winner.registration.carNumber).toBe("24");
    expect(winner.fastestLap).toBe(true);
    expect(results.find((r) => r.registration.carNumber === "11")!.status).toBe(
      "DNF",
    );
  });

  it("feeds the imported results straight into standings", async () => {
    await owner.caller.event.setStatus({ eventId, status: "COMPLETED" });
    const standings = await outsider.caller.series.standings({ seriesId });
    expect(standings.rows[0].points).toBe(25);
    expect(standings.rows[1].points).toBe(18);
    // The DNF scores nothing.
    expect(standings.rows[2].points).toBe(0);
  });

  it("re-importing updates rather than duplicating", async () => {
    const corrected = [
      "Pos,Car,Laps,Status",
      "2,24,58,Finished",
      "1,7,58,Finished",
      "3,11,55,DNF",
    ].join("\n");
    const result = await owner.caller.event.importResults({
      eventId,
      payload: corrected,
    });
    expect(result.imported).toBe(3);
    expect(await db.eventResult.count({ where: { eventId } })).toBe(3);

    const standings = await outsider.caller.series.standings({ seriesId });
    const winner = standings.rows[0];
    expect(winner.points).toBe(25);
    // Car 7 now leads after the correction.
    expect(winner.competitorLabel).toBe(`ir2_${run}`);
  });
});
