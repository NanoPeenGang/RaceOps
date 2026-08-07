import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CheckResult,
  InspectionStage,
  InspectionStatus,
  PlatformRole,
  PrismaClient,
  SeriesDiscipline,
} from "@prisma/client";
import { createCaller } from "@/server/trpc/root";

/** Technical inspection end-to-end. Opt in with RUN_DB_TESTS=1. */
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

describe.skipIf(!ENABLED)("scrutineering (integration)", () => {
  const run = Date.now();
  let organizer: Awaited<ReturnType<typeof makeUser>>;
  let entrant: Awaited<ReturnType<typeof makeUser>>;
  let outsider: Awaited<ReturnType<typeof makeUser>>;
  let seriesId: string;
  let eventId: string;
  let registrationId: string;
  let templateId: string;

  beforeAll(async () => {
    organizer = await makeUser(`scorg_${run}`);
    entrant = await makeUser(`scent_${run}`);
    outsider = await makeUser(`scout_${run}`);

    const series = await organizer.caller.series.create({
      name: `Scrutineering Cup ${run}`,
      discipline: SeriesDiscipline.REAL_WORLD,
      platform: "Circuit",
    });
    seriesId = series.id;

    const event = await organizer.caller.event.create({
      seriesId,
      name: "Tech Round",
      date: new Date(Date.now() + 864e5),
      platform: "Circuit",
    });
    eventId = event.id;
    await organizer.caller.event.setStatus({ eventId, status: "PUBLISHED" });

    const registration = await entrant.caller.event.register({
      eventId,
      carNumber: "12",
      carClass: "GT4",
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
    await db.user.deleteMany({
      where: {
        authProviderId: {
          in: [organizer, entrant, outsider].map(
            (u) => u.user.authProviderId!,
          ),
        },
      },
    });
    await db.$disconnect();
  });

  // -------------------------------------------------------------------------
  // Templates
  // -------------------------------------------------------------------------

  it("builds a reusable card of checks", async () => {
    const template = await organizer.caller.scrutineering.createTemplate({
      seriesId,
      name: "GT4 pre-event",
      stage: InspectionStage.PRE_EVENT,
    });
    templateId = template.id;

    await organizer.caller.scrutineering.addTemplateItem({
      templateId,
      label: "Seat belts in date",
      regulation: "Art. 253.6",
      sortOrder: 0,
    });
    await organizer.caller.scrutineering.addTemplateItem({
      templateId,
      label: "Minimum weight",
      regulation: "Art. 4.1",
      measureUnit: "kg",
      minValue: 1250,
      sortOrder: 1,
    });
    await organizer.caller.scrutineering.addTemplateItem({
      templateId,
      label: "Ride height",
      measureUnit: "mm",
      minValue: 40,
      maxValue: 80,
      sortOrder: 2,
    });

    // Public: entrants need to know what will be checked.
    const templates = await anon().scrutineering.templates({ seriesId });
    expect(templates[0].items).toHaveLength(3);
  });

  it("rejects a tolerance that reads backwards", async () => {
    await expect(
      organizer.caller.scrutineering.addTemplateItem({
        templateId,
        label: "Impossible",
        minValue: 100,
        maxValue: 50,
      }),
    ).rejects.toThrow(/cannot exceed the maximum/i);
  });

  it("only lets series admins write templates", async () => {
    await expect(
      outsider.caller.scrutineering.createTemplate({
        seriesId,
        name: "Sneaky card",
      }),
    ).rejects.toThrow(/permission/i);
  });

  // -------------------------------------------------------------------------
  // Working a card
  // -------------------------------------------------------------------------

  it("copies the template onto the card when it opens", async () => {
    const inspection = await organizer.caller.scrutineering.open({
      registrationId,
      templateId,
    });
    expect(inspection.checks).toHaveLength(3);
    expect(inspection.status).toBe(InspectionStatus.NOT_STARTED);
    // Tolerances come across with the labels.
    expect(inspection.checks[1].minValue).toBe(1250);
  });

  it("keeps a card intact when the template is later edited", async () => {
    const before = await anon().scrutineering.forRegistration({
      registrationId,
    });
    const item = await organizer.caller.scrutineering.addTemplateItem({
      templateId,
      label: "Added after the fact",
      sortOrder: 9,
    });

    const after = await anon().scrutineering.forRegistration({
      registrationId,
    });
    // The open card records what was actually checked on the day.
    expect(after[0].checks).toHaveLength(before[0].checks.length);
    await organizer.caller.scrutineering.removeTemplateItem({ itemId: item.id });
  });

  it("moves to in progress once a check is recorded", async () => {
    const [inspection] = await anon().scrutineering.forRegistration({
      registrationId,
    });
    await organizer.caller.scrutineering.recordCheck({
      checkId: inspection.checks[0].id,
      result: CheckResult.PASS,
    });

    const [after] = await anon().scrutineering.forRegistration({
      registrationId,
    });
    expect(after.status).toBe(InspectionStatus.IN_PROGRESS);
  });

  it("lets a measurement decide pass or fail on its own", async () => {
    const [inspection] = await anon().scrutineering.forRegistration({
      registrationId,
    });
    const weight = inspection.checks.find((c) => c.label === "Minimum weight")!;

    // Under the 1250 kg floor — no verdict sent, the number decides.
    await organizer.caller.scrutineering.recordCheck({
      checkId: weight.id,
      measuredValue: 1240,
    });
    let [after] = await anon().scrutineering.forRegistration({
      registrationId,
    });
    expect(after.checks.find((c) => c.id === weight.id)?.result).toBe(
      CheckResult.FAIL,
    );

    // Re-weighed on the limit: a limit is inclusive, so it passes.
    await organizer.caller.scrutineering.recordCheck({
      checkId: weight.id,
      measuredValue: 1250,
    });
    [after] = await anon().scrutineering.forRegistration({ registrationId });
    expect(after.checks.find((c) => c.id === weight.id)?.result).toBe(
      CheckResult.PASS,
    );
  });

  it("does not settle the card until every check is worked through", async () => {
    const [inspection] = await anon().scrutineering.forRegistration({
      registrationId,
    });
    // Two of three recorded so far.
    expect(inspection.status).toBe(InspectionStatus.IN_PROGRESS);
  });

  it("fails the card on a completed check that failed", async () => {
    const [inspection] = await anon().scrutineering.forRegistration({
      registrationId,
    });
    const ride = inspection.checks.find((c) => c.label === "Ride height")!;
    await organizer.caller.scrutineering.recordCheck({
      checkId: ride.id,
      measuredValue: 35,
    });

    const [after] = await anon().scrutineering.forRegistration({
      registrationId,
    });
    expect(after.status).toBe(InspectionStatus.FAILED);
    expect(after.completedAt).not.toBeNull();
  });

  it("turns a failed card into a penalty citing what failed", async () => {
    const [inspection] = await anon().scrutineering.forRegistration({
      registrationId,
    });
    // Also fail the belts check, which cites an article — the decision should
    // pick up a regulation from whichever failed check carries one.
    const belts = inspection.checks.find(
      (c) => c.label === "Seat belts in date",
    )!;
    await organizer.caller.scrutineering.recordCheck({
      checkId: belts.id,
      result: CheckResult.FAIL,
    });

    const penalty = await organizer.caller.scrutineering.raisePenalty({
      inspectionId: inspection.id,
    });

    expect(penalty.type).toBe("DISQUALIFICATION");
    expect(penalty.details).toContain("Ride height");
    // The measurement is carried into the decision, not just the check name.
    expect(penalty.details).toContain("35");
    expect(penalty.regulation).toBe("Art. 253.6");
  });

  it("refuses to raise a penalty from a card with no failures", async () => {
    const clean = await organizer.caller.scrutineering.open({
      registrationId,
      stage: InspectionStage.IN_EVENT,
    });
    await expect(
      organizer.caller.scrutineering.raisePenalty({ inspectionId: clean.id }),
    ).rejects.toThrow(/nothing to cite/i);
  });

  // -------------------------------------------------------------------------
  // Re-checks and referrals
  // -------------------------------------------------------------------------

  it("supersedes a failure with a re-check", async () => {
    const inspections = await anon().scrutineering.forRegistration({
      registrationId,
    });
    const failedCard = inspections.find(
      (i) => i.status === InspectionStatus.FAILED,
    )!;

    const recheck = await organizer.caller.scrutineering.open({
      registrationId,
      templateId,
      supersedesId: failedCard.id,
    });
    expect(recheck.supersedesId).toBe(failedCard.id);

    // Pass everything on the re-check.
    for (const check of recheck.checks) {
      await organizer.caller.scrutineering.recordCheck({
        checkId: check.id,
        result: CheckResult.PASS,
      });
    }

    const after = await anon().scrutineering.forRegistration({
      registrationId,
    });
    // The newest pre-event card is the car's current standing.
    const newest = after
      .filter((i) => i.stage === InspectionStage.PRE_EVENT)
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      )[0];
    expect(newest.id).toBe(recheck.id);
    expect(newest.status).toBe(InspectionStatus.PASSED);
    // The original failure is still on the record.
    expect(after.some((i) => i.id === failedCard.id)).toBe(true);
  });

  it("keeps a referral even when the checks would say otherwise", async () => {
    const inspections = await anon().scrutineering.forRegistration({
      registrationId,
    });
    const passed = inspections.find(
      (i) => i.status === InspectionStatus.PASSED,
    )!;

    await organizer.caller.scrutineering.refer({
      inspectionId: passed.id,
      notes: "Bodywork queried by a competitor.",
    });

    // Recording another check must not recompute the referral away.
    await organizer.caller.scrutineering.recordCheck({
      checkId: passed.checks[0].id,
      result: CheckResult.PASS,
    });

    const after = await anon().scrutineering.forRegistration({
      registrationId,
    });
    expect(after.find((i) => i.id === passed.id)?.status).toBe(
      InspectionStatus.REFERRED,
    );
  });

  it("notifies the entrant on a referral", async () => {
    const count = await db.notification.count({
      where: { userId: entrant.user.id },
    });
    expect(count).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // Access
  // -------------------------------------------------------------------------

  it("keeps the bay worklist to organizers but the record public", async () => {
    await expect(
      entrant.caller.scrutineering.forEvent({ eventId }),
    ).rejects.toThrow(/permission/i);

    // A car's technical record belongs on the entry, so it is readable.
    const record = await anon().scrutineering.forRegistration({
      registrationId,
    });
    expect(record.length).toBeGreaterThan(0);
  });

  it("does not let an entrant record checks on their own car", async () => {
    const [inspection] = await anon().scrutineering.forRegistration({
      registrationId,
    });
    await expect(
      entrant.caller.scrutineering.recordCheck({
        checkId: inspection.checks[0].id,
        result: CheckResult.PASS,
      }),
    ).rejects.toThrow(/permission/i);
  });
});
