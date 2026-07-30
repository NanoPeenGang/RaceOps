import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  FlagState,
  LogCategory,
  PenaltyType,
  PrismaClient,
  SeriesDiscipline,
  SeriesRole,
  SessionStatus,
  SessionType,
} from "@prisma/client";
import { createCaller } from "@/server/trpc/root";

/** Officials' log and audit trail end-to-end. */
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

describe.skipIf(!ENABLED)("officials' log (integration)", () => {
  const run = Date.now();
  let owner: Awaited<ReturnType<typeof makeUser>>;
  let raceControl: Awaited<ReturnType<typeof makeUser>>;
  let entrant: Awaited<ReturnType<typeof makeUser>>;
  let seriesId: string;
  let eventId: string;
  let sessionId: string;
  let registrationId: string;
  let penaltyId: string;

  beforeAll(async () => {
    owner = await makeUser(`logown_${run}`);
    raceControl = await makeUser(`logrc_${run}`);
    entrant = await makeUser(`logent_${run}`);

    const series = await owner.caller.series.create({
      name: `Log Cup ${run}`,
      discipline: SeriesDiscipline.REAL_WORLD,
      platform: "Circuit",
    });
    seriesId = series.id;
    await db.seriesMembership.create({
      data: {
        seriesId,
        userId: raceControl.user.id,
        role: SeriesRole.RACE_CONTROL,
      },
    });

    const event = await owner.caller.event.create({
      seriesId,
      name: "Round 1",
      date: new Date(Date.now() + 864e5),
      platform: "Circuit",
    });
    eventId = event.id;
    await owner.caller.event.setStatus({ eventId, status: "PUBLISHED" });

    const session = await owner.caller.session.create({
      eventId,
      type: SessionType.RACE,
      name: "Race",
      startsAt: new Date(Date.now() + 864e5),
      endsAt: new Date(Date.now() + 864e5 + 3_600_000),
    });
    sessionId = session.id;

    registrationId = (
      await entrant.caller.event.register({ eventId, carNumber: "7" })
    ).id;
    await owner.caller.event.setRegistrationStatus({
      registrationId,
      status: "CONFIRMED",
    });
  });

  afterAll(async () => {
    if (ENABLED) await db.$disconnect();
  });

  it("logs session and flag changes as they happen", async () => {
    await raceControl.caller.session.setLiveState({
      sessionId,
      status: SessionStatus.LIVE,
    });
    await raceControl.caller.session.setLiveState({
      sessionId,
      flagState: FlagState.GREEN,
    });
    await raceControl.caller.session.setLiveState({
      sessionId,
      flagState: FlagState.SAFETY_CAR,
    });

    const log = await raceControl.caller.log.forEvent({ eventId });
    const summaries = log.entries.map((entry) => entry.summary);
    expect(summaries).toContain("Race: started");
    expect(summaries).toContain("Race: no flag → green");
    expect(summaries).toContain("Race: green → safety car");
    // The transition is the record — the session row only holds the current
    // flag, so this cannot be reconstructed afterwards.
    expect(log.summary.byCategory.FLAG).toBe(2);
  });

  it("does not log a change that changed nothing", async () => {
    const before = await raceControl.caller.log.forEvent({ eventId });
    await raceControl.caller.session.setLiveState({
      sessionId,
      flagState: FlagState.SAFETY_CAR,
    });
    const after = await raceControl.caller.log.forEvent({ eventId });
    expect(after.summary.total).toBe(before.summary.total);
  });

  it("logs a penalty and records who issued it", async () => {
    const penalty = await raceControl.caller.penalty.issue({
      registrationId,
      type: PenaltyType.TIME_PENALTY,
      summary: "Track limits, turn 4",
      timeSeconds: 5,
    });
    penaltyId = penalty.id;

    const log = await raceControl.caller.log.forEvent({
      eventId,
      category: LogCategory.PENALTY,
    });
    expect(log.entries[0].summary).toContain("Track limits");

    const audit = await owner.caller.log.audit({
      eventId,
      entityType: "Penalty",
    });
    expect(audit.items[0].action).toBe("CREATE");
    expect(audit.items[0].actor?.id).toBe(raceControl.user.id);
  });

  it("records the before and after when a penalty is amended", async () => {
    await raceControl.caller.penalty.update({
      penaltyId,
      timeSeconds: 10,
      summary: "Track limits, turn 4 (repeat offence)",
    });

    const audit = await owner.caller.log.audit({
      eventId,
      entityType: "Penalty",
      entityId: penaltyId,
    });
    const amendment = audit.items.find((item) => item.action === "UPDATE");
    expect(amendment?.changes).toMatchObject({
      timeSeconds: { from: 5, to: 10 },
    });
  });

  it("records a result amendment with what it used to say", async () => {
    await raceControl.caller.event.recordResult({
      registrationId,
      finishPosition: 3,
    });
    await raceControl.caller.event.recordResult({
      registrationId,
      finishPosition: 4,
    });

    const audit = await owner.caller.log.audit({
      eventId,
      entityType: "EventResult",
    });
    const amendment = audit.items.find((item) => item.action === "UPDATE");
    expect(amendment?.changes).toMatchObject({
      finishPosition: { from: 3, to: 4 },
    });
    // The original classification is recorded too.
    expect(audit.items.some((item) => item.action === "CREATE")).toBe(true);
  });

  it("keeps the audit trail to owners and admins, not race control", async () => {
    await expect(
      raceControl.caller.log.audit({ eventId }),
    ).rejects.toThrow(/permission/i);
    await expect(entrant.caller.log.audit({ eventId })).rejects.toThrow(
      /permission/i,
    );
  });

  it("keeps hand-written notes internal until they are published", async () => {
    await raceControl.caller.log.add({
      eventId,
      category: LogCategory.NOTE,
      summary: "Watching car 7 for track limits",
    });

    const publicView = await callerFor(null).log.forEvent({ eventId });
    expect(
      publicView.entries.some((entry) => entry.summary.includes("Watching")),
    ).toBe(false);
    expect(publicView.isOfficial).toBe(false);
    // Automatic entries are public facts and appear straight away.
    expect(
      publicView.entries.some((entry) => entry.summary === "Race: started"),
    ).toBe(true);
  });

  it("does not release working notes when the bulletin is published", async () => {
    await raceControl.caller.log.publishBulletin({ eventId });
    const bulletin = await callerFor(null).log.bulletin({ eventId });
    const everything = bulletin.sections.flatMap((section) => section.entries);
    expect(
      everything.some((entry) => entry.summary.includes("Watching")),
    ).toBe(false);
    expect(everything.length).toBeGreaterThan(0);
  });

  it("groups the bulletin by category in meeting order", async () => {
    const bulletin = await callerFor(null).log.bulletin({ eventId });
    const order = bulletin.sections.map((section) => section.category);
    expect(order.indexOf(LogCategory.SESSION)).toBeLessThan(
      order.indexOf(LogCategory.FLAG),
    );
    expect(order.indexOf(LogCategory.FLAG)).toBeLessThan(
      order.indexOf(LogCategory.PENALTY),
    );
  });

  it("publishes a note when an official chooses to", async () => {
    const entry = await raceControl.caller.log.add({
      eventId,
      category: LogCategory.NOTE,
      summary: "Driver briefing held at 09:00",
      published: true,
    });
    expect(entry.published).toBe(true);

    const bulletin = await callerFor(null).log.bulletin({ eventId });
    const notes = bulletin.sections.find(
      (section) => section.category === LogCategory.NOTE,
    );
    expect(
      notes?.entries.some((e) => e.summary.includes("Driver briefing")),
    ).toBe(true);
  });

  it("refuses a log entry for another event's session", async () => {
    const other = await owner.caller.event.create({
      seriesId,
      name: "Round 2",
      date: new Date(Date.now() + 2 * 864e5),
      platform: "Circuit",
    });
    await expect(
      raceControl.caller.log.add({
        eventId: other.id,
        summary: "Wrong session",
        sessionId,
      }),
    ).rejects.toThrow(/not part of this event/i);
  });

  it("keeps log writing to officials", async () => {
    await expect(
      entrant.caller.log.add({ eventId, summary: "Not my log" }),
    ).rejects.toThrow(/permission/i);
  });
});
