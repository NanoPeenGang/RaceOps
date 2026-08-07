import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PlatformRole,
  PrismaClient,
  SeriesDiscipline,
  SeriesRole,
  WaiverAudience,
} from "@prisma/client";
import { createCaller } from "@/server/trpc/root";

/** Waivers, e-signature and the confirmation gate. */
const ENABLED = process.env.RUN_DB_TESTS === "1";
const db = ENABLED ? new PrismaClient() : (null as unknown as PrismaClient);

function callerFor(clerkUserId: string | null, headers?: Headers) {
  return createCaller({
    db,
    clerkUserId,
    headers: headers ?? new Headers(),
  });
}

async function makeUser(suffix: string, dateOfBirth?: Date) {
  const user = await db.user.create({
    data: {
      email: `${suffix}@example.test`,
      authProviderId: `clerk_${suffix}`,
      // Platform staff, so these fixtures bypass the access-request queue —
      // the queue itself is exercised in access-flow.test.ts, and making every
      // suite apply for a team first would test one gate thirty times.
      platformRole: PlatformRole.ADMIN,
      profile: { create: { displayName: suffix, dateOfBirth } },
    },
  });
  return { user, caller: callerFor(user.authProviderId) };
}

const BODY =
  "I acknowledge that motorsport is dangerous and accept the risks of participating in this event.";

describe.skipIf(!ENABLED)("waivers (integration)", () => {
  const run = Date.now();
  let owner: Awaited<ReturnType<typeof makeUser>>;
  let raceControl: Awaited<ReturnType<typeof makeUser>>;
  let driver: Awaited<ReturnType<typeof makeUser>>;
  let minor: Awaited<ReturnType<typeof makeUser>>;
  let seriesId: string;
  let eventId: string;
  let registrationId: string;
  let waiverId: string;

  beforeAll(async () => {
    owner = await makeUser(`wvown_${run}`);
    raceControl = await makeUser(`wvrc_${run}`);
    driver = await makeUser(`wvdrv_${run}`, new Date(1990, 0, 1));
    minor = await makeUser(`wvmin_${run}`, new Date(2014, 0, 1));

    const series = await owner.caller.series.create({
      name: `Waiver Cup ${run}`,
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

    registrationId = (
      await driver.caller.event.register({ eventId, carNumber: "7" })
    ).id;
  });

  afterAll(async () => {
    if (ENABLED) await db.$disconnect();
  });

  it("publishes a waiver and shows the wording publicly", async () => {
    const waiver = await owner.caller.waiver.create({
      eventId,
      title: "Indemnity",
      body: BODY,
      audience: WaiverAudience.ALL_PARTICIPANTS,
      required: true,
      minSigningAge: 18,
    });
    waiverId = waiver.id;
    expect(waiver.version).toBe(1);

    // Someone deciding whether to enter can read it before signing up.
    const listed = await callerFor(null).waiver.forEvent({ eventId });
    expect(listed.map((w) => w.id)).toContain(waiverId);
    expect(listed[0].body).toBe(BODY);
  });

  it("blocks confirmation while a required waiver is unsigned", async () => {
    await expect(
      owner.caller.event.setRegistrationStatus({
        registrationId,
        status: "CONFIRMED",
      }),
    ).rejects.toThrow(/Waivers unsigned/i);
  });

  it("records the evidence around the signature, not just the name", async () => {
    const headers = new Headers({
      "x-forwarded-for": "203.0.113.7, 10.0.0.1",
      "user-agent": "RaceOpsTest/1.0",
    });
    const signature = await callerFor(
      driver.user.authProviderId,
      headers,
    ).waiver.sign({
      waiverId,
      waiverVersion: 1,
      signedName: "Sam Driver",
      registrationId,
    });

    expect(signature.waiverVersion).toBe(1);
    // The first hop is the client; the rest is the proxy chain.
    expect(signature.ipAddress).toBe("203.0.113.7");
    expect(signature.userAgent).toBe("RaceOpsTest/1.0");
    expect(signature.signedEmail).toBe(driver.user.email);
  });

  it("lets the entry be confirmed once signed", async () => {
    const updated = await owner.caller.event.setRegistrationStatus({
      registrationId,
      status: "CONFIRMED",
    });
    expect(updated.status).toBe("CONFIRMED");
  });

  it("treats a double submit as one signature", async () => {
    const again = await driver.caller.waiver.sign({
      waiverId,
      waiverVersion: 1,
      signedName: "Sam Driver",
    });
    const all = await owner.caller.waiver.signatures({ waiverId });
    expect(all.items).toHaveLength(1);
    expect(again.id).toBe(all.items[0].id);
  });

  it("refuses a signature against a version that is no longer current", async () => {
    await owner.caller.waiver.update({
      waiverId,
      body: `${BODY} I also agree to abide by the sporting regulations.`,
    });
    const waiver = await callerFor(null).waiver.byId({ waiverId });
    expect(waiver.version).toBe(2);

    await expect(
      driver.caller.waiver.sign({
        waiverId,
        waiverVersion: 1,
        signedName: "Sam Driver",
      }),
    ).rejects.toThrow(/wording of this waiver has changed/i);
  });

  it("marks an old signature as no longer covering the current wording", async () => {
    const state = await driver.caller.waiver.mine({ eventId });
    const status = state.statuses.find((s) => s.waiverId === waiverId)!;
    expect(status.signed).toBe(false);
    expect(status.signedOldVersion).toBe(true);
    expect(state.outstanding).toHaveLength(1);
  });

  it("does not bump the version for a title-only edit", async () => {
    const before = await callerFor(null).waiver.byId({ waiverId });
    await owner.caller.waiver.update({
      waiverId,
      title: "Indemnity and assumption of risk",
    });
    const after = await callerFor(null).waiver.byId({ waiverId });
    expect(after.version).toBe(before.version);
  });

  it("requires a guardian below the signing age", async () => {
    const minorRegistration = await minor.caller.event.register({
      eventId,
      carNumber: "8",
    });
    const state = await minor.caller.waiver.mine({ eventId });
    expect(state.capacity[waiverId]).toBe("guardian");

    await expect(
      minor.caller.waiver.sign({
        waiverId,
        waiverVersion: 2,
        signedName: "Young Driver",
        registrationId: minorRegistration.id,
      }),
    ).rejects.toThrow(/parent or guardian/i);

    const signature = await minor.caller.waiver.sign({
      waiverId,
      waiverVersion: 2,
      signedName: "Young Driver",
      registrationId: minorRegistration.id,
      guardianName: "A Parent",
      guardianRelation: "Parent",
    });
    expect(signature.guardianName).toBe("A Parent");
  });

  it("refuses an empty signature", async () => {
    await expect(
      driver.caller.waiver.sign({
        waiverId,
        waiverVersion: 2,
        signedName: " x",
      }),
    ).rejects.toThrow();
  });

  it("keeps the signature record to owners and admins", async () => {
    await expect(
      raceControl.caller.waiver.signatures({ waiverId }),
    ).rejects.toThrow(/permission/i);
    await expect(driver.caller.waiver.signatures({ waiverId })).rejects.toThrow(
      /permission/i,
    );
  });

  it("keeps waiver authoring to owners and admins", async () => {
    await expect(
      raceControl.caller.waiver.create({
        eventId,
        title: "Not mine",
        body: BODY,
      }),
    ).rejects.toThrow(/permission/i);
  });

  it("retires rather than deletes a waiver that has signatures", async () => {
    const retired = await owner.caller.waiver.retire({ waiverId });
    expect(retired?.active).toBe(false);
    // The signatures survive — they have to be producible years later.
    const signatures = await owner.caller.waiver.signatures({ waiverId });
    expect(signatures.items.length).toBeGreaterThan(0);
  });

  it("applies a series waiver at every round", async () => {
    const seriesWaiver = await owner.caller.waiver.create({
      seriesId,
      title: "Season indemnity",
      body: BODY,
    });
    const round2 = await owner.caller.event.create({
      seriesId,
      name: "Round 2",
      date: new Date(Date.now() + 2 * 864e5),
      platform: "Circuit",
    });
    const applicable = await callerFor(null).waiver.forEvent({
      eventId: round2.id,
    });
    expect(applicable.map((w) => w.id)).toContain(seriesWaiver.id);
  });
});
