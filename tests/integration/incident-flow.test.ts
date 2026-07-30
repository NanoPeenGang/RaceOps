import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  IncidentSource,
  IncidentStatus,
  PenaltyType,
  PrismaClient,
  SeriesDiscipline,
  SeriesRole,
} from "@prisma/client";
import { createCaller } from "@/server/trpc/root";
import { isIncidentOpen } from "@/lib/incidents";

/** Incident reports and the stewards' queue. Opt in with RUN_DB_TESTS=1. */
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

const anon = () => callerFor(null);

describe.skipIf(!ENABLED)("incidents & stewarding (integration)", () => {
  const run = Date.now();
  let organizer: Awaited<ReturnType<typeof makeUser>>;
  let steward: Awaited<ReturnType<typeof makeUser>>;
  let racerA: Awaited<ReturnType<typeof makeUser>>;
  let racerB: Awaited<ReturnType<typeof makeUser>>;
  let outsider: Awaited<ReturnType<typeof makeUser>>;
  let seriesId: string;
  let eventId: string;
  let regA: string;
  let regB: string;

  beforeAll(async () => {
    organizer = await makeUser(`inorg_${run}`);
    steward = await makeUser(`instew_${run}`);
    racerA = await makeUser(`inra_${run}`);
    racerB = await makeUser(`inrb_${run}`);
    outsider = await makeUser(`inout_${run}`);

    const series = await organizer.caller.series.create({
      name: `Stewarding Cup ${run}`,
      discipline: SeriesDiscipline.REAL_WORLD,
      platform: "Circuit",
    });
    seriesId = series.id;
    await organizer.caller.series.setOrganizer({
      seriesId,
      userId: steward.user.id,
      role: SeriesRole.STEWARD,
    });

    const event = await organizer.caller.event.create({
      seriesId,
      name: "Stewarding Round",
      date: new Date(Date.now() + 864e5),
      platform: "Circuit",
    });
    eventId = event.id;
    await organizer.caller.event.setStatus({ eventId, status: "PUBLISHED" });

    for (const [racer, number] of [
      [racerA, "10"],
      [racerB, "20"],
    ] as const) {
      const registration = await racer.caller.event.register({
        eventId,
        carNumber: number,
      });
      await organizer.caller.event.setRegistrationStatus({
        registrationId: registration.id,
        status: "CONFIRMED",
      });
      if (racer === racerA) regA = registration.id;
      else regB = registration.id;
    }
  });

  afterAll(async () => {
    if (!ENABLED) return;
    await db.series.deleteMany({ where: { id: seriesId } });
    await db.user.deleteMany({
      where: {
        authProviderId: {
          in: [organizer, steward, racerA, racerB, outsider].map(
            (u) => u.user.authProviderId!,
          ),
        },
      },
    });
    await db.$disconnect();
  });

  // -------------------------------------------------------------------------
  // Filing
  // -------------------------------------------------------------------------

  it("lets a competitor report another car and notifies the officials", async () => {
    const before = await db.notification.count({
      where: { userId: steward.user.id },
    });

    const incident = await racerA.caller.incident.file({
      eventId,
      subjectRegistrationId: regB,
      reportedByRegistrationId: regA,
      summary: "Contact at the apex of turn 5, spun me around",
      lapNumber: 12,
      location: "Turn 5",
    });
    expect(incident.status).toBe(IncidentStatus.REPORTED);
    expect(incident.source).toBe(IncidentSource.COMPETITOR);

    // Stewards need to know something landed in the queue.
    expect(
      await db.notification.count({ where: { userId: steward.user.id } }),
    ).toBe(before + 1);
  });

  it("stops a competitor filing as race control or a marshal post", async () => {
    for (const source of [
      IncidentSource.RACE_CONTROL,
      IncidentSource.MARSHAL,
    ]) {
      await expect(
        racerA.caller.incident.file({
          eventId,
          source,
          summary: "Pretending to be an official",
        }),
      ).rejects.toThrow(/only officials/i);
    }
  });

  it("stops someone filing on behalf of an entry that is not theirs", async () => {
    await expect(
      racerA.caller.incident.file({
        eventId,
        reportedByRegistrationId: regB,
        summary: "Filing as somebody else's entry",
      }),
    ).rejects.toThrow(/on behalf of that entry/i);
  });

  it("refuses an entry from another event", async () => {
    const other = await organizer.caller.event.create({
      seriesId,
      name: "Other Round",
      date: new Date(Date.now() + 30 * 864e5),
      platform: "Circuit",
    });
    await organizer.caller.event.setStatus({
      eventId: other.id,
      status: "PUBLISHED",
    });
    const foreign = await racerA.caller.event.register({
      eventId: other.id,
      carNumber: "10",
    });

    await expect(
      racerA.caller.incident.file({
        eventId,
        subjectRegistrationId: foreign.id,
        summary: "Cross-event report that should not stand",
      }),
    ).rejects.toThrow(/not part of this event/i);
  });

  it("lets race control file its own observation", async () => {
    const incident = await organizer.caller.incident.file({
      eventId,
      source: IncidentSource.RACE_CONTROL,
      subjectRegistrationId: regA,
      summary: "Track limits, repeated at turn 9",
      lapNumber: 18,
    });
    expect(incident.source).toBe(IncidentSource.RACE_CONTROL);
  });

  // -------------------------------------------------------------------------
  // Visibility
  // -------------------------------------------------------------------------

  it("keeps open investigations off the public record", async () => {
    const publicView = await anon().incident.forEvent({ eventId });
    // Nothing decided yet, so the public queue is empty.
    expect(publicView.incidents).toEqual([]);
    expect(publicView.isOfficial).toBe(false);

    const officialView = await steward.caller.incident.forEvent({ eventId });
    expect(officialView.isOfficial).toBe(true);
    expect(officialView.incidents.length).toBeGreaterThanOrEqual(2);
    expect(officialView.summary.open).toBeGreaterThanOrEqual(2);
  });

  it("lets the parties involved read a report the public cannot", async () => {
    const queue = await steward.caller.incident.forEvent({ eventId });
    const reported = queue.incidents.find(
      (i) => i.source === IncidentSource.COMPETITOR,
    )!;

    // The reporter and the entry named can both see it.
    await expect(
      racerA.caller.incident.byId({ incidentId: reported.id }),
    ).resolves.toBeTruthy();
    await expect(
      racerB.caller.incident.byId({ incidentId: reported.id }),
    ).resolves.toBeTruthy();

    // An unrelated signed-in user cannot.
    await expect(
      outsider.caller.incident.byId({ incidentId: reported.id }),
    ).rejects.toThrow();
  });

  // -------------------------------------------------------------------------
  // Triage
  // -------------------------------------------------------------------------

  it("walks a report through triage", async () => {
    const queue = await steward.caller.incident.forEvent({ eventId });
    const target = queue.incidents.find(
      (i) => i.source === IncidentSource.RACE_CONTROL,
    )!;

    await steward.caller.incident.setStatus({
      incidentId: target.id,
      status: IncidentStatus.NOTED,
    });
    await steward.caller.incident.setStatus({
      incidentId: target.id,
      status: IncidentStatus.UNDER_INVESTIGATION,
    });

    // Cannot walk backwards out of an investigation.
    await expect(
      steward.caller.incident.setStatus({
        incidentId: target.id,
        status: IncidentStatus.NOTED,
      }),
    ).rejects.toThrow(/cannot move a report/i);

    const closed = await steward.caller.incident.setStatus({
      incidentId: target.id,
      status: IncidentStatus.NO_FURTHER_ACTION,
      decisionNotes: "Within track limits allowance.",
    });
    expect(closed.decidedById).toBe(steward.user.id);
    expect(closed.decidedAt).not.toBeNull();
  });

  it("keeps a closed report closed", async () => {
    const queue = await steward.caller.incident.forEvent({ eventId });
    const closed = queue.incidents.find(
      (i) => i.status === IncidentStatus.NO_FURTHER_ACTION,
    )!;
    await expect(
      steward.caller.incident.setStatus({
        incidentId: closed.id,
        status: IncidentStatus.UNDER_INVESTIGATION,
      }),
    ).rejects.toThrow(/cannot move a report/i);
  });

  it("publishes a decided report and notifies whoever filed it", async () => {
    const publicView = await anon().incident.forEvent({ eventId });
    // A decision is a public record even though the investigation was not.
    expect(publicView.incidents.length).toBe(1);
    expect(publicView.incidents[0].decisionNotes).toContain("track limits");
  });

  it("does not let a competitor triage the queue", async () => {
    const queue = await steward.caller.incident.forEvent({ eventId });
    const open = queue.incidents.find((i) => i.status === IncidentStatus.REPORTED)!;
    await expect(
      racerA.caller.incident.setStatus({
        incidentId: open.id,
        status: IncidentStatus.NO_FURTHER_ACTION,
      }),
    ).rejects.toThrow(/permission/i);
  });

  // -------------------------------------------------------------------------
  // Penalties
  // -------------------------------------------------------------------------

  it("closes a report by issuing a penalty that cites it", async () => {
    const queue = await steward.caller.incident.forEvent({ eventId });
    const open = queue.incidents.find(
      (i) => i.status === IncidentStatus.REPORTED && i.subject !== null,
    )!;

    const penalty = await steward.caller.incident.issuePenalty({
      incidentId: open.id,
      type: PenaltyType.TIME_PENALTY,
      summary: "Causing a collision",
      timeSeconds: 10,
      regulation: "Art. 27.4",
    });

    expect(penalty.registrationId).toBe(regB);
    expect(penalty.timeSeconds).toBe(10);
    // The lap from the report carries into the decision.
    expect(penalty.lapNumber).toBe(12);
    expect(penalty.details).toContain("Contact at the apex");

    const after = await steward.caller.incident.byId({ incidentId: open.id });
    expect(after.status).toBe(IncidentStatus.PENALTY_ISSUED);
    expect(after.penaltyId).toBe(penalty.id);

    // The penalty is on the entry's public record too.
    const penalties = await anon().penalty.forEvent({ eventId });
    expect(penalties.map((p) => p.id)).toContain(penalty.id);
  });

  it("refuses a penalty on a report that names no entry", async () => {
    const orphan = await organizer.caller.incident.file({
      eventId,
      source: IncidentSource.MARSHAL,
      summary: "Debris on the racing line at turn 3",
    });
    await expect(
      steward.caller.incident.issuePenalty({
        incidentId: orphan.id,
        type: PenaltyType.WARNING,
        summary: "Nobody to penalize",
      }),
    ).rejects.toThrow(/nobody to penalize/i);
  });

  it("refuses a penalty on a report already closed", async () => {
    const queue = await steward.caller.incident.forEvent({ eventId });
    const closed = queue.incidents.find(
      (i) => i.status === IncidentStatus.PENALTY_ISSUED,
    )!;
    await expect(
      steward.caller.incident.issuePenalty({
        incidentId: closed.id,
        type: PenaltyType.WARNING,
        summary: "Second bite",
      }),
    ).rejects.toThrow(/already closed/i);
  });

  // -------------------------------------------------------------------------
  // Responses and withdrawal
  // -------------------------------------------------------------------------

  it("gives the entry named a right of reply", async () => {
    const protest = await racerA.caller.incident.file({
      eventId,
      source: IncidentSource.PROTEST,
      subjectRegistrationId: regB,
      reportedByRegistrationId: regA,
      summary: "Formal protest over the restart procedure",
    });

    await racerB.caller.incident.respond({
      incidentId: protest.id,
      body: "We held station until the control line.",
    });

    const view = await racerB.caller.incident.byId({ incidentId: protest.id });
    expect(view.responses).toHaveLength(1);
    expect(view.involved).toBe(true);

    // An outsider cannot join the conversation.
    await expect(
      outsider.caller.incident.respond({
        incidentId: protest.id,
        body: "Butting in",
      }),
    ).rejects.toThrow(/parties involved/i);
  });

  it("keeps an official's internal note away from competitors", async () => {
    const queue = await steward.caller.incident.forEvent({ eventId });
    const protest = queue.incidents.find(
      (i) => i.source === IncidentSource.PROTEST,
    )!;

    await steward.caller.incident.respond({
      incidentId: protest.id,
      body: "Reviewing the onboard before the hearing.",
      visibleToCompetitors: false,
    });

    const officialView = await steward.caller.incident.byId({
      incidentId: protest.id,
    });
    const competitorView = await racerB.caller.incident.byId({
      incidentId: protest.id,
    });
    expect(officialView.responses.length).toBe(
      competitorView.responses.length + 1,
    );

    // A competitor cannot leave one either.
    await expect(
      racerB.caller.incident.respond({
        incidentId: protest.id,
        body: "Secretly",
        visibleToCompetitors: false,
      }),
    ).rejects.toThrow(/only officials/i);
  });

  it("sorts protests to the front of the open queue", async () => {
    const queue = await steward.caller.incident.forEvent({ eventId });
    const openRows = queue.incidents.filter((i) => isIncidentOpen(i.status));
    // A protest carries a fee and a deadline, so it is worked first.
    expect(openRows[0].source).toBe(IncidentSource.PROTEST);
    expect(queue.summary.protests).toBeGreaterThanOrEqual(1);
  });

  it("lets whoever filed a report withdraw it, but nobody else", async () => {
    const filed = await racerA.caller.incident.file({
      eventId,
      subjectRegistrationId: regB,
      summary: "Filed in anger, withdrawn on reflection",
    });

    await expect(
      racerB.caller.incident.withdraw({ incidentId: filed.id }),
    ).rejects.toThrow(/only whoever filed/i);

    const withdrawn = await racerA.caller.incident.withdraw({
      incidentId: filed.id,
    });
    expect(withdrawn.status).toBe(IncidentStatus.WITHDRAWN);

    // And a withdrawn report cannot be withdrawn twice.
    await expect(
      racerA.caller.incident.withdraw({ incidentId: filed.id }),
    ).rejects.toThrow(/already closed/i);
  });

  it("lists a reporter's own filings", async () => {
    const mine = await racerA.caller.incident.mine();
    expect(mine.length).toBeGreaterThanOrEqual(2);
    expect(mine.every((i) => i.event.id === eventId)).toBe(true);
  });
});
