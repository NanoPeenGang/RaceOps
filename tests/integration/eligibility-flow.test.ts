import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  LineupRole,
  PlatformRole,
  PrismaClient,
  RequirementEnforcement,
  RequirementKind,
  SeriesDiscipline,
} from "@prisma/client";
import { createCaller } from "@/server/trpc/root";

/** Entry requirements and the confirmation gate. Opt in with RUN_DB_TESTS=1. */
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

describe.skipIf(!ENABLED)("entry eligibility (integration)", () => {
  const run = Date.now();
  let organizer: Awaited<ReturnType<typeof makeUser>>;
  let manager: Awaited<ReturnType<typeof makeUser>>;
  let licensed: Awaited<ReturnType<typeof makeUser>>;
  let unlicensed: Awaited<ReturnType<typeof makeUser>>;
  let seriesId: string;
  let eventId: string;
  let teamId: string;
  let registrationId: string;
  let licenceReqId: string;

  beforeAll(async () => {
    organizer = await makeUser(`elorg_${run}`);
    manager = await makeUser(`elmgr_${run}`);
    licensed = await makeUser(`ellic_${run}`);
    unlicensed = await makeUser(`elunlic_${run}`);

    // Only one driver holds the licence the series will demand.
    const profile = await db.profile.findUniqueOrThrow({
      where: { userId: licensed.user.id },
    });
    await db.realWorldCredential.create({
      data: {
        profileId: profile.id,
        kind: "FIA_LICENSE",
        title: "National A",
      },
    });

    const team = await manager.caller.team.create({ name: `El Team ${run}` });
    teamId = team.id;

    const series = await organizer.caller.series.create({
      name: `Eligibility Cup ${run}`,
      discipline: SeriesDiscipline.REAL_WORLD,
      platform: "Circuit",
    });
    seriesId = series.id;

    const event = await organizer.caller.event.create({
      seriesId,
      name: "Round 1",
      date: new Date(Date.now() + 864e5),
      platform: "Circuit",
    });
    eventId = event.id;
    await organizer.caller.event.setStatus({ eventId, status: "PUBLISHED" });

    const registration = await manager.caller.event.register({
      eventId,
      teamId,
      carNumber: "5",
    });
    registrationId = registration.id;
  });

  afterAll(async () => {
    if (!ENABLED) return;
    await db.series.deleteMany({ where: { id: seriesId } });
    await db.team.deleteMany({ where: { id: teamId } });
    await db.user.deleteMany({
      where: {
        authProviderId: {
          in: [organizer, manager, licensed, unlicensed].map(
            (u) => u.user.authProviderId!,
          ),
        },
      },
    });
    await db.$disconnect();
  });

  // -------------------------------------------------------------------------
  // Defining requirements
  // -------------------------------------------------------------------------

  it("confirms freely when a series sets no requirements", async () => {
    const state = await anon().eligibility.forRegistration({ registrationId });
    expect(state.eligible).toBe(true);
    expect(state.summary).toBe("No requirements");

    await organizer.caller.event.setRegistrationStatus({
      registrationId,
      status: "CONFIRMED",
    });
    // Back to pending so the gate below has something to block. Waitlisting
    // would not do: with spare capacity the entry is promoted straight back.
    await db.eventRegistration.update({
      where: { id: registrationId },
      data: { status: "PENDING" },
    });
  });

  it("rejects a requirement missing the field its kind needs", async () => {
    await expect(
      organizer.caller.eligibility.create({
        seriesId,
        kind: RequirementKind.CREDENTIAL,
        label: "Some licence",
      }),
    ).rejects.toThrow(/needs a credential kind/i);
    await expect(
      organizer.caller.eligibility.create({
        seriesId,
        kind: RequirementKind.SIM_RATING,
        label: "Fast enough",
      }),
    ).rejects.toThrow(/platform and a minimum/i);
    await expect(
      organizer.caller.eligibility.create({
        seriesId,
        kind: RequirementKind.MIN_AGE,
        label: "Old enough",
      }),
    ).rejects.toThrow(/needs a minimum age/i);
  });

  it("only lets series admins define requirements", async () => {
    await expect(
      manager.caller.eligibility.create({
        seriesId,
        kind: RequirementKind.CREDENTIAL,
        label: "Sneaky",
        credentialKind: "FIA_LICENSE",
      }),
    ).rejects.toThrow(/permission/i);
  });

  it("publishes requirements so entrants can read them", async () => {
    const created = await organizer.caller.eligibility.create({
      seriesId,
      kind: RequirementKind.CREDENTIAL,
      label: "National A licence",
      credentialKind: "FIA_LICENSE",
    });
    licenceReqId = created.id;

    const published = await anon().eligibility.forSeries({ seriesId });
    expect(published.map((r) => r.label)).toContain("National A licence");
  });

  // -------------------------------------------------------------------------
  // Checking drivers
  // -------------------------------------------------------------------------

  it("checks each declared driver, not the entrant", async () => {
    await manager.caller.lineup.addDriver({
      registrationId,
      userId: licensed.user.id,
      role: LineupRole.DRIVER_OF_RECORD,
    });
    await manager.caller.lineup.addDriver({
      registrationId,
      userId: unlicensed.user.id,
    });

    const state = await anon().eligibility.forRegistration({ registrationId });
    expect(state.findings).toHaveLength(2);

    const met = state.findings.find((f) => f.userId === licensed.user.id);
    const notMet = state.findings.find((f) => f.userId === unlicensed.user.id);
    expect(met?.state).toBe("met");
    expect(notMet?.state).toBe("not_met");
    // One non-compliant driver makes the whole entry ineligible.
    expect(state.eligible).toBe(false);
  });

  it("blocks confirmation and names what is outstanding", async () => {
    await expect(
      organizer.caller.event.setRegistrationStatus({
        registrationId,
        status: "CONFIRMED",
      }),
    ).rejects.toThrow(/Entry requirements outstanding/i);

    // The message has to be actionable, so it names the driver and the rule.
    await expect(
      organizer.caller.event.setRegistrationStatus({
        registrationId,
        status: "CONFIRMED",
      }),
    ).rejects.toThrow(/National A licence/);
  });

  it("lets an organizer sign off and then confirm", async () => {
    await organizer.caller.eligibility.decide({
      requirementId: licenceReqId,
      registrationId,
      userId: unlicensed.user.id,
      granted: true,
      reason: "Licence presented at sign-on.",
    });

    const state = await anon().eligibility.forRegistration({ registrationId });
    expect(
      state.findings.find((f) => f.userId === unlicensed.user.id)?.state,
    ).toBe("waived");
    expect(state.eligible).toBe(true);

    await organizer.caller.event.setRegistrationStatus({
      registrationId,
      status: "CONFIRMED",
    });
    const confirmed = await db.eventRegistration.findUniqueOrThrow({
      where: { id: registrationId },
    });
    expect(confirmed.status).toBe("CONFIRMED");
  });

  it("lets an organizer withdraw a sign-off", async () => {
    await organizer.caller.eligibility.clearDecision({
      requirementId: licenceReqId,
      registrationId,
      userId: unlicensed.user.id,
    });
    const state = await anon().eligibility.forRegistration({ registrationId });
    expect(state.eligible).toBe(false);

    // Restore it — later assertions expect a confirmed entry.
    await organizer.caller.eligibility.decide({
      requirementId: licenceReqId,
      registrationId,
      userId: unlicensed.user.id,
      granted: true,
    });
  });

  it("does not let an entrant sign off their own requirements", async () => {
    await expect(
      manager.caller.eligibility.decide({
        requirementId: licenceReqId,
        registrationId,
        userId: unlicensed.user.id,
        granted: true,
      }),
    ).rejects.toThrow(/permission/i);
  });

  // -------------------------------------------------------------------------
  // Scoping and enforcement
  // -------------------------------------------------------------------------

  it("applies a class requirement only to entries in that class", async () => {
    const fast = await organizer.caller.series.createClass({
      seriesId,
      name: "Pro",
    });
    await organizer.caller.eligibility.create({
      seriesId,
      seriesClassId: fast.id,
      kind: RequirementKind.MIN_AGE,
      label: "18 and over",
      minAge: 18,
    });

    // The entry is unclassified, so the Pro requirement does not apply.
    let state = await anon().eligibility.forRegistration({ registrationId });
    expect(state.findings.some((f) => f.requirementLabel === "18 and over")).toBe(
      false,
    );

    await organizer.caller.series.setEntryClass({
      registrationId,
      seriesClassId: fast.id,
    });
    state = await anon().eligibility.forRegistration({ registrationId });
    expect(state.findings.some((f) => f.requirementLabel === "18 and over")).toBe(
      true,
    );

    await organizer.caller.series.setEntryClass({
      registrationId,
      seriesClassId: null,
    });
  });

  it("refuses a requirement scoped to another series' class", async () => {
    const other = await organizer.caller.series.create({
      name: `El Other ${run}`,
      discipline: SeriesDiscipline.SIM,
      platform: "iRacing",
    });
    const foreign = await organizer.caller.series.createClass({
      seriesId: other.id,
      name: "Foreign",
    });
    await expect(
      organizer.caller.eligibility.create({
        seriesId,
        seriesClassId: foreign.id,
        kind: RequirementKind.CREDENTIAL,
        label: "Cross-series",
        credentialKind: "FIA_LICENSE",
      }),
    ).rejects.toThrow(/different series/i);
    await db.series.delete({ where: { id: other.id } });
  });

  it("reports an advisory requirement without blocking on it", async () => {
    const advisory = await organizer.caller.eligibility.create({
      seriesId,
      kind: RequirementKind.SIM_RATING,
      label: "2000 iRating suggested",
      simPlatform: "iracing",
      minRating: 2000,
      enforcement: RequirementEnforcement.ADVISORY,
    });

    const state = await anon().eligibility.forRegistration({ registrationId });
    const finding = state.findings.find(
      (f) => f.requirementId === advisory.id && f.userId === licensed.user.id,
    );
    expect(finding?.state).toBe("not_met");
    // Reported, but the entry is still eligible.
    expect(state.eligible).toBe(true);

    await organizer.caller.eligibility.remove({ requirementId: advisory.id });
  });

  it("stops checking a retired requirement", async () => {
    await organizer.caller.eligibility.update({
      requirementId: licenceReqId,
      active: false,
    });
    const state = await anon().eligibility.forRegistration({ registrationId });
    expect(
      state.findings.some((f) => f.requirementId === licenceReqId),
    ).toBe(false);

    await organizer.caller.eligibility.update({
      requirementId: licenceReqId,
      active: true,
    });
  });

  it("gives race control a desk view across the whole event", async () => {
    const rows = await organizer.caller.eligibility.forEvent({ eventId });
    const ours = rows.find((row) => row.registrationId === registrationId)!;
    expect(ours.carNumber).toBe("5");
    expect(ours.findings.length).toBeGreaterThan(0);

    // Not a public record.
    await expect(
      manager.caller.eligibility.forEvent({ eventId }),
    ).rejects.toThrow(/permission/i);
  });

  it("falls back to the entrant when no crew is declared", async () => {
    const solo = await unlicensed.caller.event.register({
      eventId,
      carNumber: "77",
    });
    const state = await anon().eligibility.forRegistration({
      registrationId: solo.id,
    });
    // No line-up, so the entrant themselves is checked.
    expect(state.findings).toHaveLength(1);
    expect(state.findings[0].userId).toBe(unlicensed.user.id);
    expect(state.eligible).toBe(false);
  });
});
