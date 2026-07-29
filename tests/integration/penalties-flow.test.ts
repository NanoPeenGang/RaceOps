import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AppealStatus,
  PenaltyType,
  PrismaClient,
  ResultStatus,
  SeriesDiscipline,
  SeriesRole,
} from "@prisma/client";
import { createCaller } from "@/server/trpc/root";

/**
 * Penalty -> appeal -> standings, against a real Postgres.
 * Opt in with RUN_DB_TESTS=1 (see tests/integration/organizer-flow.test.ts).
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

describe.skipIf(!ENABLED)("penalties & standings (integration)", () => {
  const run = Date.now();
  let director: Awaited<ReturnType<typeof makeUser>>;
  let steward: Awaited<ReturnType<typeof makeUser>>;
  let racer: Awaited<ReturnType<typeof makeUser>>;
  let outsider: Awaited<ReturnType<typeof makeUser>>;
  let seriesId: string;
  let eventId: string;
  let registrationId: string;
  let penaltyId: string;

  beforeAll(async () => {
    director = await makeUser(`dir_${run}`);
    steward = await makeUser(`stew_${run}`);
    racer = await makeUser(`racer_${run}`);
    outsider = await makeUser(`out_${run}`);

    const series = await director.caller.series.create({
      name: `Penalty Cup ${run}`,
      discipline: SeriesDiscipline.SIM,
      platform: "iRacing",
    });
    seriesId = series.id;
    await director.caller.series.setOrganizer({
      seriesId,
      userId: steward.user.id,
      role: SeriesRole.STEWARD,
    });

    const event = await director.caller.event.create({
      seriesId,
      name: "Round 1",
      date: new Date(Date.now() + 864e5),
      platform: "iRacing",
    });
    eventId = event.id;
    await director.caller.event.setStatus({ eventId, status: "PUBLISHED" });

    const registration = await racer.caller.event.register({
      eventId,
      carNumber: "10",
    });
    registrationId = registration.id;
    await director.caller.event.setRegistrationStatus({
      registrationId,
      status: "CONFIRMED",
    });
  });

  afterAll(async () => {
    if (!ENABLED) return;
    await db.series.deleteMany({ where: { id: seriesId } });
    await db.user.deleteMany({
      where: {
        authProviderId: {
          in: [
            director.user.authProviderId,
            steward.user.authProviderId,
            racer.user.authProviderId,
            outsider.user.authProviderId,
          ],
        },
      },
    });
    await db.$disconnect();
  });

  it("rejects a penalty type whose magnitude is missing", async () => {
    await expect(
      director.caller.penalty.issue({
        registrationId,
        type: PenaltyType.POINTS_DEDUCTION,
        summary: "Missing magnitude",
      }),
    ).rejects.toThrow(/positive/i);
  });

  it("lets race control issue a points penalty", async () => {
    const penalty = await director.caller.penalty.issue({
      registrationId,
      type: PenaltyType.POINTS_DEDUCTION,
      summary: "Causing a collision",
      pointsDeducted: 10,
      regulation: "27.4",
      lapNumber: 12,
    });
    penaltyId = penalty.id;
    expect(penalty.status).toBe("ISSUED");
  });

  it("refuses penalties from users with no series role", async () => {
    await expect(
      outsider.caller.penalty.issue({
        registrationId,
        type: PenaltyType.WARNING,
        summary: "Not authorized",
      }),
    ).rejects.toThrow(/permission/i);
  });

  it("publishes the penalty on the competitor's series record", async () => {
    const record = await outsider.caller.penalty.forCompetitorInSeries({
      seriesId,
      userId: racer.user.id,
    });
    expect(record).toHaveLength(1);
    expect(record[0].summary).toBe("Causing a collision");
  });

  it("stops anyone but the competitor from appealing", async () => {
    await expect(
      outsider.caller.penalty.fileAppeal({
        penaltyId,
        statement: "I am not involved in this entry at all, but here goes.",
      }),
    ).rejects.toThrow(/competitor/i);
  });

  it("moves the penalty under appeal when the competitor files", async () => {
    await racer.caller.penalty.fileAppeal({
      penaltyId,
      statement:
        "Telemetry shows I was fully alongside before the apex; the contact was unavoidable.",
    });
    const penalty = await db.penalty.findUniqueOrThrow({
      where: { id: penaltyId },
    });
    expect(penalty.status).toBe("UNDER_APPEAL");
  });

  it("blocks a second appeal on the same penalty", async () => {
    await expect(
      racer.caller.penalty.fileAppeal({
        penaltyId,
        statement: "A second attempt at appealing the very same decision.",
      }),
    ).rejects.toThrow(/already been appealed/i);
  });

  it("still deducts points while the appeal is pending", async () => {
    await director.caller.event.recordResult({
      registrationId,
      finishPosition: 1,
      status: ResultStatus.FINISHED,
    });
    await director.caller.event.setStatus({ eventId, status: "COMPLETED" });

    const standings = await outsider.caller.series.standings({ seriesId });
    const row = standings.rows[0];
    expect(row.grossPoints).toBe(25);
    expect(row.pointsDeducted).toBe(10);
    expect(row.points).toBe(15);
  });

  it("restores the points when a steward upholds the appeal", async () => {
    const appeal = await db.penaltyAppeal.findUniqueOrThrow({
      where: { penaltyId },
    });
    await steward.caller.penalty.decideAppeal({
      appealId: appeal.id,
      outcome: AppealStatus.UPHELD,
      decision: "Appeal upheld — the contact was a racing incident.",
    });

    const penalty = await db.penalty.findUniqueOrThrow({
      where: { id: penaltyId },
    });
    expect(penalty.status).toBe("OVERTURNED");

    const standings = await outsider.caller.series.standings({ seriesId });
    expect(standings.rows[0].points).toBe(25);
    expect(standings.rows[0].pointsDeducted).toBe(0);
    // The penalty stays on the public record even though it no longer counts.
    expect(standings.rows[0].penaltyCount).toBe(1);
  });

  it("refuses to rule on an appeal twice", async () => {
    const appeal = await db.penaltyAppeal.findUniqueOrThrow({
      where: { penaltyId },
    });
    await expect(
      steward.caller.penalty.decideAppeal({
        appealId: appeal.id,
        outcome: AppealStatus.REJECTED,
        decision: "Trying to re-decide an appeal that is already closed.",
      }),
    ).rejects.toThrow(/already been decided/i);
  });

  it("keeps penalty evidence scoped to race control", async () => {
    await expect(
      racer.caller.media.attach({
        url: "https://example.test/clip.mp4",
        kind: "video",
        scope: { penaltyId },
      }),
    ).rejects.toThrow(/permission/i);

    const evidence = await director.caller.media.attach({
      url: "https://example.test/clip.mp4",
      kind: "video",
      title: "Turn 4 onboard",
      scope: { penaltyId },
    });
    expect(evidence.penaltyId).toBe(penaltyId);
  });
});
