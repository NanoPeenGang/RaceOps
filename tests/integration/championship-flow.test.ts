import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  LineupRole,
  PlatformRole,
  PrismaClient,
  ResultStatus,
  SeriesDiscipline,
} from "@prisma/client";
import { createCaller } from "@/server/trpc/root";

/**
 * Multi-class championships end-to-end: free-form classes, per-class tables,
 * drivers'/teams' tables, dropped scores and title eligibility.
 * Opt in with RUN_DB_TESTS=1.
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

const anon = () => callerFor(null);

type Standings = Awaited<
  ReturnType<ReturnType<typeof anon>["series"]["standings"]>
>;

function table(
  standings: Standings,
  basis: "entrant" | "driver" | "team",
  seriesClassId: string | null = null,
) {
  return standings.tables.find(
    (t) => t.basis === basis && t.seriesClassId === seriesClassId,
  )!;
}

describe.skipIf(!ENABLED)("multi-class championships (integration)", () => {
  const run = Date.now();
  let organizer: Awaited<ReturnType<typeof makeUser>>;
  let outsider: Awaited<ReturnType<typeof makeUser>>;
  let seriesId: string;
  const classIds: Record<string, string> = {};

  /** Runs a round and classifies the given entries. */
  async function runRound(
    name: string,
    entries: {
      teamId?: string;
      userId?: string;
      classId?: string;
      finish: number;
      drivers?: string[];
    }[],
    opts: { multiplier?: number } = {},
  ) {
    const event = await organizer.caller.event.create({
      seriesId,
      name,
      date: new Date(Date.now() - 864e5),
      platform: "Circuit",
    });
    await organizer.caller.event.setStatus({
      eventId: event.id,
      status: "PUBLISHED",
    });
    if (opts.multiplier) {
      await organizer.caller.series.setEventPointsMultiplier({
        eventId: event.id,
        pointsMultiplier: opts.multiplier,
      });
    }

    for (const entry of entries) {
      const registration = await db.eventRegistration.create({
        data: {
          eventId: event.id,
          teamId: entry.teamId,
          entrantUserId: entry.teamId ? undefined : entry.userId,
          submittedById: organizer.user.id,
          seriesClassId: entry.classId,
          status: "CONFIRMED",
        },
      });
      for (const driverId of entry.drivers ?? []) {
        await db.registrationDriver.create({
          data: {
            registrationId: registration.id,
            userId: driverId,
            role: LineupRole.DRIVER,
          },
        });
      }
      await organizer.caller.event.recordResult({
        registrationId: registration.id,
        finishPosition: entry.finish,
        status: ResultStatus.FINISHED,
      });
    }

    await organizer.caller.event.setStatus({
      eventId: event.id,
      status: "COMPLETED",
    });
    return event.id;
  }

  beforeAll(async () => {
    organizer = await makeUser(`chorg_${run}`);
    outsider = await makeUser(`chout_${run}`);

    const series = await organizer.caller.series.create({
      name: `Club Championship ${run}`,
      discipline: SeriesDiscipline.REAL_WORLD,
      platform: "Circuit",
    });
    seriesId = series.id;
  });

  afterAll(async () => {
    if (!ENABLED) return;
    await db.series.deleteMany({ where: { id: seriesId } });
    await db.team.deleteMany({ where: { name: { startsWith: `ch_${run}` } } });
    await db.user.deleteMany({
      where: { authProviderId: { startsWith: `clerk_ch` } },
    });
    await db.$disconnect();
  });

  // -------------------------------------------------------------------------
  // Classes
  // -------------------------------------------------------------------------

  it("starts with no classes and scores everyone in one table", async () => {
    const classes = await anon().series.classes({ seriesId });
    expect(classes).toEqual([]);
  });

  it("accepts free-form class names, not a fixed set", async () => {
    // Names a grass-roots region would actually use.
    const names = [
      "Spec Miata",
      "Improved Production <2L",
      "ST-X",
      "Novice",
      "Vintage Group 4",
    ];
    for (const [index, name] of names.entries()) {
      const created = await organizer.caller.series.createClass({
        seriesId,
        name,
        code: name.slice(0, 3).toUpperCase(),
        grouping: index < 2 ? "Run Group 1" : "Run Group 2",
        sortOrder: index,
      });
      classIds[name] = created.id;
    }

    const classes = await anon().series.classes({ seriesId });
    expect(classes.map((c) => c.name)).toEqual(names);
    expect(classes[0].grouping).toBe("Run Group 1");
  });

  it("refuses a duplicate class name in the same series", async () => {
    await expect(
      organizer.caller.series.createClass({ seriesId, name: "Spec Miata" }),
    ).rejects.toThrow(/already has a class/i);
  });

  it("only lets series admins manage classes", async () => {
    await expect(
      outsider.caller.series.createClass({ seriesId, name: "Sneaky" }),
    ).rejects.toThrow(/permission/i);
  });

  it("scales to many classes", async () => {
    // Autocross regions run dozens; nothing may assume a handful.
    const extra = await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        organizer.caller.series.createClass({
          seriesId,
          name: `Autocross Class ${i}`,
          sortOrder: 100 + i,
        }),
      ),
    );
    const classes = await anon().series.classes({ seriesId });
    expect(classes.length).toBeGreaterThanOrEqual(30);
    for (const created of extra) {
      await organizer.caller.series.deleteClass({ classId: created.id });
    }
  });

  // -------------------------------------------------------------------------
  // Per-class scoring
  // -------------------------------------------------------------------------

  it("scores each class as its own championship", async () => {
    const miata = classIds["Spec Miata"];
    const stx = classIds["ST-X"];

    const [alice, bob, carol] = await Promise.all([
      makeUser(`chalice_${run}`),
      makeUser(`chbob_${run}`),
      makeUser(`chcarol_${run}`),
    ]);

    await runRound("Round 1", [
      { userId: alice.user.id, classId: miata, finish: 1, drivers: [alice.user.id] },
      { userId: bob.user.id, classId: miata, finish: 2, drivers: [bob.user.id] },
      { userId: carol.user.id, classId: stx, finish: 3, drivers: [carol.user.id] },
    ]);

    const standings = await anon().series.standings({ seriesId });

    // Overall counts everyone.
    expect(table(standings, "entrant").rows).toHaveLength(3);

    // Each class is scored on its own, using the positions as recorded.
    const miataRows = table(standings, "entrant", miata).rows;
    expect(miataRows.map((r) => r.points)).toEqual([25, 18]);

    const stxRows = table(standings, "entrant", stx).rows;
    expect(stxRows).toHaveLength(1);
    expect(stxRows[0].points).toBe(15);

    // A class nobody entered still has a table, just an empty one.
    expect(table(standings, "entrant", classIds["Novice"]).rows).toEqual([]);
  });

  it("gives a class its own points scale when one is set", async () => {
    const stx = classIds["ST-X"];
    await organizer.caller.series.updateClass({
      classId: stx,
      // A small class scoring flat 10/6/4 rather than the FIA scale.
      pointsScheme: { "1": 10, "2": 6, "3": 4 },
    });

    const standings = await anon().series.standings({ seriesId });
    // Carol finished 3rd, so 4 under the class scale instead of 15.
    expect(table(standings, "entrant", stx).rows[0].points).toBe(4);
    // The overall table still uses the series scale.
    const overall = table(standings, "entrant").rows;
    expect(overall.find((r) => r.points === 15)).toBeDefined();

    await organizer.caller.series.updateClass({
      classId: stx,
      pointsScheme: null,
    });
  });

  it("refuses to put an entry in another series' class", async () => {
    const other = await organizer.caller.series.create({
      name: `Other Series ${run}`,
      discipline: SeriesDiscipline.SIM,
      platform: "iRacing",
    });
    const foreign = await organizer.caller.series.createClass({
      seriesId: other.id,
      name: "Foreign Class",
    });
    const registration = await db.eventRegistration.findFirstOrThrow({
      where: { event: { seriesId } },
    });

    await expect(
      organizer.caller.series.setEntryClass({
        registrationId: registration.id,
        seriesClassId: foreign.id,
      }),
    ).rejects.toThrow(/different series/i);

    await db.series.delete({ where: { id: other.id } });
  });

  it("keeps results when a class is deleted, leaving entries unclassified", async () => {
    const doomed = await organizer.caller.series.createClass({
      seriesId,
      name: `Doomed ${run}`,
    });
    const registration = await db.eventRegistration.findFirstOrThrow({
      where: { event: { seriesId } },
    });
    await organizer.caller.series.setEntryClass({
      registrationId: registration.id,
      seriesClassId: doomed.id,
    });

    const result = await organizer.caller.series.deleteClass({
      classId: doomed.id,
    });
    expect(result.unclassifiedEntries).toBe(1);

    // The entry survives with no class rather than being deleted.
    const after = await db.eventRegistration.findUniqueOrThrow({
      where: { id: registration.id },
    });
    expect(after.seriesClassId).toBeNull();

    await organizer.caller.series.setEntryClass({
      registrationId: registration.id,
      seriesClassId: classIds["Spec Miata"],
    });
  });

  // -------------------------------------------------------------------------
  // Drivers' and teams' tables
  // -------------------------------------------------------------------------

  it("builds separate drivers' and teams' championships", async () => {
    const team = await db.team.create({
      data: { name: `ch_${run} Apex`, slug: `ch-${run}-apex` },
    });
    const [ann, ben] = await Promise.all([
      makeUser(`chann_${run}`),
      makeUser(`chben_${run}`),
    ]);

    await runRound("Round 2", [
      {
        teamId: team.id,
        classId: classIds["Spec Miata"],
        finish: 1,
        drivers: [ann.user.id, ben.user.id],
      },
    ]);

    const standings = await anon().series.standings({ seriesId });

    // Both crew members take the entry's points.
    const drivers = table(standings, "driver").rows;
    expect(drivers.find((r) => r.competitorKey === ann.user.id)?.points).toBe(25);
    expect(drivers.find((r) => r.competitorKey === ben.user.id)?.points).toBe(25);

    // The team scores it once.
    const teams = table(standings, "team").rows;
    expect(teams.find((r) => r.competitorKey === team.id)?.points).toBe(25);

    // Drivers are labelled by name, not by id.
    expect(
      drivers.find((r) => r.competitorKey === ann.user.id)?.competitorLabel,
    ).toContain("chann");
  });

  // -------------------------------------------------------------------------
  // Season rules
  // -------------------------------------------------------------------------

  it("applies a double-points finale", async () => {
    const solo = await makeUser(`chfin_${run}`);
    await runRound(
      "Finale",
      [
        {
          userId: solo.user.id,
          classId: classIds["Novice"],
          finish: 1,
          drivers: [solo.user.id],
        },
      ],
      { multiplier: 2 },
    );

    const standings = await anon().series.standings({ seriesId });
    const rows = table(standings, "entrant", classIds["Novice"]).rows;
    expect(rows[0].points).toBe(50);
  });

  it("counts only the best N rounds when dropped scores are configured", async () => {
    const dropper = await makeUser(`chdrop_${run}`);
    const novice = classIds["Novice"];

    await runRound("Drop A", [
      { userId: dropper.user.id, classId: novice, finish: 1, drivers: [dropper.user.id] },
    ]);
    await runRound("Drop B", [
      { userId: dropper.user.id, classId: novice, finish: 10, drivers: [dropper.user.id] },
    ]);

    let standings = await anon().series.standings({ seriesId });
    let row = table(standings, "entrant", novice).rows.find(
      (r) => r.competitorKey === dropper.user.id,
    )!;
    expect(row.points).toBe(26);

    await organizer.caller.series.setChampionshipRules({
      seriesId,
      countBestRounds: 1,
    });

    standings = await anon().series.standings({ seriesId });
    row = table(standings, "entrant", novice).rows.find(
      (r) => r.competitorKey === dropper.user.id,
    )!;
    expect(row.points).toBe(25);
    expect(row.droppedRounds).toBe(1);
    // The dropped round is still a start on the record.
    expect(row.starts).toBe(2);

    await organizer.caller.series.setChampionshipRules({
      seriesId,
      countBestRounds: null,
    });
  });

  it("marks competitors short of the minimum starts as title ineligible", async () => {
    await organizer.caller.series.setChampionshipRules({
      seriesId,
      minStartsForTitle: 2,
    });

    const standings = await anon().series.standings({ seriesId });
    const rows = table(standings, "entrant", classIds["Novice"]).rows;
    const eligible = rows.filter((r) => r.titleEligible);
    const ineligible = rows.filter((r) => !r.titleEligible);
    expect(ineligible.length).toBeGreaterThan(0);
    // Eligible competitors sort above ineligible ones regardless of points.
    if (eligible.length > 0) {
      expect(rows.indexOf(eligible[0])).toBeLessThan(rows.indexOf(ineligible[0]));
    }

    await organizer.caller.series.setChampionshipRules({
      seriesId,
      minStartsForTitle: null,
    });
  });

  it("reports how many rounds have been scored", async () => {
    const standings = await anon().series.standings({ seriesId });
    expect(standings.roundsScored).toBeGreaterThanOrEqual(4);
  });
});
