import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  EventStatus,
  PenaltyType,
  PlatformRole,
  PrismaClient,
  ResultStatus,
  SeriesDiscipline,
  SessionType,
  TimingStatus,
} from "@prisma/client";
import { createCaller } from "@/server/trpc/root";
import { GET as overlayFeed } from "@/app/api/broadcast/[sessionId]/route";

/** Commentator pack and the stream-overlay feed. */
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

async function fetchOverlay(sessionId: string) {
  const response = await overlayFeed(new Request("http://test/"), {
    params: Promise.resolve({ sessionId }),
  });
  return { response, body: await response.json() };
}

describe.skipIf(!ENABLED)("broadcast (integration)", () => {
  const run = Date.now();
  let organizer: Awaited<ReturnType<typeof makeUser>>;
  let leader: Awaited<ReturnType<typeof makeUser>>;
  let chaser: Awaited<ReturnType<typeof makeUser>>;
  let seriesId: string;
  let round1: string;
  let round2: string;
  let sessionId: string;
  const entries: Record<string, string> = {};

  beforeAll(async () => {
    organizer = await makeUser(`bcorg_${run}`);
    leader = await makeUser(`bclead_${run}`);
    chaser = await makeUser(`bcchase_${run}`);

    const series = await organizer.caller.series.create({
      name: `Broadcast Cup ${run}`,
      discipline: SeriesDiscipline.REAL_WORLD,
      platform: "Circuit",
    });
    seriesId = series.id;

    // Round 1 is run and scored; round 2 is the one being broadcast.
    const first = await organizer.caller.event.create({
      seriesId,
      name: "Round 1",
      date: new Date(Date.now() - 864e5),
      platform: "Circuit",
    });
    round1 = first.id;
    await organizer.caller.event.setStatus({
      eventId: round1,
      status: EventStatus.PUBLISHED,
    });

    for (const [key, user, number] of [
      ["leader", leader, "1"],
      ["chaser", chaser, "2"],
    ] as const) {
      const registration = await user.caller.event.register({
        eventId: round1,
        carNumber: number,
      });
      await organizer.caller.event.setRegistrationStatus({
        registrationId: registration.id,
        status: "CONFIRMED",
      });
      entries[`${key}R1`] = registration.id;
    }

    await organizer.caller.event.recordResult({
      registrationId: entries.leaderR1,
      finishPosition: 1,
      status: ResultStatus.FINISHED,
    });
    await organizer.caller.event.recordResult({
      registrationId: entries.chaserR1,
      finishPosition: 2,
      status: ResultStatus.FINISHED,
    });
    await organizer.caller.penalty.issue({
      registrationId: entries.chaserR1,
      type: PenaltyType.TIME_PENALTY,
      summary: "Track limits",
      timeSeconds: 5,
    });
    await organizer.caller.event.setStatus({
      eventId: round1,
      status: EventStatus.COMPLETED,
    });

    const second = await organizer.caller.event.create({
      seriesId,
      name: "Round 2",
      date: new Date(Date.now() + 864e5),
      platform: "Circuit",
    });
    round2 = second.id;
    await organizer.caller.event.setStatus({
      eventId: round2,
      status: EventStatus.PUBLISHED,
    });

    for (const [key, user, number] of [
      ["leader", leader, "1"],
      ["chaser", chaser, "2"],
    ] as const) {
      const registration = await user.caller.event.register({
        eventId: round2,
        carNumber: number,
      });
      await organizer.caller.event.setRegistrationStatus({
        registrationId: registration.id,
        status: "CONFIRMED",
      });
      entries[`${key}R2`] = registration.id;
    }

    const session = await organizer.caller.session.create({
      eventId: round2,
      type: SessionType.RACE,
      name: "Race",
      startsAt: new Date(Date.now() + 864e5),
      endsAt: new Date(Date.now() + 864e5 + 3_600_000),
    });
    sessionId = session.id;
  });

  afterAll(async () => {
    if (ENABLED) await db.$disconnect();
  });

  it("builds a commentator pack with championship standing per entry", async () => {
    const pack = await callerFor(null).document.commentatorPack({
      eventId: round2,
    });
    expect(pack.series?.name).toBe(`Broadcast Cup ${run}`);

    const leaderEntry = pack.entries.find((e) => e.carNumber === "1")!;
    const chaserEntry = pack.entries.find((e) => e.carNumber === "2")!;
    expect(leaderEntry.championshipPosition).toBe(1);
    expect(leaderEntry.pointsBehindLeader).toBe(0);
    expect(chaserEntry.pointsBehindLeader).toBeGreaterThan(0);
    expect(leaderEntry.wins).toBe(1);
    // Penalties on the public record are fair game for a commentator.
    expect(chaserEntry.penaltyCount).toBe(1);
  });

  it("produces talking points a commentator can read out", async () => {
    const pack = await callerFor(null).document.commentatorPack({
      eventId: round2,
    });
    expect(pack.talkingPoints.length).toBeGreaterThan(0);
    expect(pack.talkingPoints[0]).toMatch(/leads|level on points/);
  });

  it("serves an overlay feed with pre-formatted values", async () => {
    await organizer.caller.session.seedTiming({ sessionId });
    await organizer.caller.session.pushTiming({
      sessionId,
      registrationId: entries.leaderR2,
      position: 1,
      lapsCompleted: 12,
      lastLap: "1:29.500",
      bestLap: "1:29.100",
      status: TimingStatus.RUNNING,
    });
    await organizer.caller.session.pushTiming({
      sessionId,
      registrationId: entries.chaserR2,
      position: 2,
      lapsCompleted: 12,
      lastLap: "1:30.200",
      bestLap: "1:29.800",
      status: TimingStatus.PIT,
    });

    const { response, body } = await fetchOverlay(sessionId);
    expect(response.status).toBe(200);
    expect(body.session.name).toBe("Race");
    expect(body.rows).toHaveLength(2);
    // Strings, not milliseconds — the overlay does no arithmetic.
    expect(body.rows[0].gap).toBe("Leader");
    expect(body.rows[0].bestLap).toBe("1:29.100");
    expect(body.rows[1].inPit).toBe(true);
    expect(body.fastestLap.carNumber).toBe("1");
    expect(typeof body.updatedAt).toBe("string");
  });

  it("lets a browser source read it cross-origin", async () => {
    const { response } = await fetchOverlay(sessionId);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("does not cache a live board", async () => {
    await organizer.caller.session.setLiveState({ sessionId, status: "LIVE" });
    const { response } = await fetchOverlay(sessionId);
    expect(response.headers.get("cache-control")).toBe("no-store");

    await organizer.caller.session.setLiveState({
      sessionId,
      status: "FINISHED",
    });
    const after = await fetchOverlay(sessionId);
    expect(after.response.headers.get("cache-control")).toContain("max-age");
  });

  it("refuses to expose a draft event's session", async () => {
    const draft = await organizer.caller.event.create({
      seriesId,
      name: "Unannounced",
      date: new Date(Date.now() + 30 * 864e5),
      platform: "Circuit",
    });
    const draftSession = await organizer.caller.session.create({
      eventId: draft.id,
      type: SessionType.RACE,
      name: "Secret race",
      startsAt: new Date(Date.now() + 30 * 864e5),
      endsAt: new Date(Date.now() + 30 * 864e5 + 3_600_000),
    });

    const { response } = await fetchOverlay(draftSession.id);
    expect(response.status).toBe(404);
  });

  it("404s for a session that does not exist", async () => {
    const { response } = await fetchOverlay("clxxxxxxxxxxxxxxxxxxxxxxx");
    expect(response.status).toBe(404);
  });
});
