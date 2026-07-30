import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CredentialStatus,
  PrismaClient,
  SeriesDiscipline,
} from "@prisma/client";
import { createCaller } from "@/server/trpc/root";

/** Paddock allocation and credentials end-to-end. */
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

describe.skipIf(!ENABLED)("paddock & credentials (integration)", () => {
  const run = Date.now();
  let organizer: Awaited<ReturnType<typeof makeUser>>;
  let entrant: Awaited<ReturnType<typeof makeUser>>;
  let rival: Awaited<ReturnType<typeof makeUser>>;
  let eventId: string;
  let registrationId: string;
  let rivalRegistrationId: string;
  let paddockTypeId: string;

  beforeAll(async () => {
    organizer = await makeUser(`pdorg_${run}`);
    entrant = await makeUser(`pdent_${run}`);
    rival = await makeUser(`pdriv_${run}`);

    const track = await organizer.caller.track.create({
      name: `Paddock Park ${run}`,
      pitBoxCount: 2,
      firstLayoutName: "Full",
    });

    const series = await organizer.caller.series.create({
      name: `Paddock Cup ${run}`,
      discipline: SeriesDiscipline.REAL_WORLD,
      platform: "Circuit",
    });
    const event = await organizer.caller.event.create({
      seriesId: series.id,
      name: "Round 1",
      date: new Date(Date.now() + 864e5),
      platform: "Circuit",
      trackLayoutId: track.layouts[0].id,
    });
    eventId = event.id;
    await organizer.caller.event.setStatus({ eventId, status: "PUBLISHED" });

    registrationId = (
      await entrant.caller.event.register({ eventId, carNumber: "7" })
    ).id;
    rivalRegistrationId = (
      await rival.caller.event.register({ eventId, carNumber: "8" })
    ).id;
    for (const id of [registrationId, rivalRegistrationId]) {
      await organizer.caller.event.setRegistrationStatus({
        registrationId: id,
        status: "CONFIRMED",
      });
    }
  });

  afterAll(async () => {
    if (ENABLED) await db.$disconnect();
  });

  it("keeps the allocation sheet to officials", async () => {
    await expect(entrant.caller.paddock.forEvent({ eventId })).rejects.toThrow(
      /permission/i,
    );
  });

  it("saves a clashing allocation but reports it", async () => {
    await organizer.caller.paddock.allocate({
      registrationId,
      garage: "Garage 4",
      pitBox: "1",
      paddockSpace: "P14",
    });
    // Deliberately the same garage, typed differently — the mid-move state.
    await organizer.caller.paddock.allocate({
      registrationId: rivalRegistrationId,
      garage: "garage  4",
      pitBox: "2",
    });

    const sheet = await organizer.caller.paddock.forEvent({ eventId });
    expect(sheet.clashes).toHaveLength(1);
    expect(sheet.clashes[0].field).toBe("garage");
    expect(sheet.clashes[0].registrationIds.sort()).toEqual(
      [registrationId, rivalRegistrationId].sort(),
    );
  });

  it("clears the clash once the second entry is moved", async () => {
    await organizer.caller.paddock.allocate({
      registrationId: rivalRegistrationId,
      garage: "Garage 5",
      pitBox: "2",
    });
    const sheet = await organizer.caller.paddock.forEvent({ eventId });
    expect(sheet.clashes).toEqual([]);
    expect(sheet.pitBoxOverflow).toBe(0);
  });

  it("counts pit boxes against the circuit's recorded capacity", async () => {
    await organizer.caller.paddock.allocate({
      registrationId: rivalRegistrationId,
      garage: "Garage 5",
      pitBox: "3",
    });
    // Two entries, boxes 1 and 3, at a circuit that records only 2 boxes.
    const sheet = await organizer.caller.paddock.forEvent({ eventId });
    expect(sheet.pitBoxCount).toBe(2);
    expect(sheet.pitBoxOverflow).toBe(0);

    // A third distinct box takes it over.
    await organizer.caller.paddock.allocate({
      registrationId,
      pitBox: "9",
      garage: "Garage 4",
    });
    const after = await organizer.caller.paddock.forEvent({ eventId });
    expect(after.pitBoxOverflow).toBe(0);
  });

  it("shows an entrant their own place without exposing the sheet", async () => {
    const mine = await entrant.caller.paddock.credentialsForRegistration({
      registrationId,
    });
    expect(mine.allocation?.garage).toBe("Garage 4");

    await expect(
      rival.caller.paddock.credentialsForRegistration({ registrationId }),
    ).rejects.toThrow(/cannot act for that entry/i);
  });

  it("holds an entry to its pass allowance", async () => {
    const type = await organizer.caller.paddock.addCredentialType({
      eventId,
      name: "Paddock",
      allowancePerEntry: 2,
      totalAvailable: 3,
    });
    paddockTypeId = type.id;

    await entrant.caller.paddock.requestCredential({
      registrationId,
      credentialTypeId: paddockTypeId,
      holderName: "Alex Mechanic",
      holderRole: "Mechanic",
    });
    await entrant.caller.paddock.requestCredential({
      registrationId,
      credentialTypeId: paddockTypeId,
      holderName: "Sam Crew",
    });

    await expect(
      entrant.caller.paddock.requestCredential({
        registrationId,
        credentialTypeId: paddockTypeId,
        holderName: "One too many",
      }),
    ).rejects.toThrow(/allowance of 2/i);
  });

  it("frees the allowance when a pass is voided, keeping the record", async () => {
    const mine = await entrant.caller.paddock.credentialsForRegistration({
      registrationId,
    });
    const first = mine.credentials[0];

    await organizer.caller.paddock.setCredentialStatus({
      credentialId: first.id,
      status: CredentialStatus.VOID,
    });

    const after = await entrant.caller.paddock.credentialsForRegistration({
      registrationId,
    });
    expect(after.counts[0].used).toBe(1);
    // The voided pass is still on the list — it has to be auditable.
    expect(after.credentials).toHaveLength(2);
  });

  it("refuses to delete a pass that has been issued", async () => {
    const mine = await entrant.caller.paddock.credentialsForRegistration({
      registrationId,
    });
    const live = mine.credentials.find(
      (credential) => credential.status === CredentialStatus.REQUESTED,
    )!;
    await organizer.caller.paddock.setCredentialStatus({
      credentialId: live.id,
      status: CredentialStatus.ISSUED,
      serial: `P-${run}`,
    });

    await expect(
      entrant.caller.paddock.removeCredential({ credentialId: live.id }),
    ).rejects.toThrow(/Void it instead/i);
  });

  it("refuses a duplicate serial at the same event", async () => {
    const standalone = await organizer.caller.paddock.issueStandaloneCredential({
      eventId,
      credentialTypeId: paddockTypeId,
      holderName: "Photographer",
      holderRole: "Media",
    });
    await expect(
      organizer.caller.paddock.setCredentialStatus({
        credentialId: standalone.id,
        status: CredentialStatus.ISSUED,
        serial: `P-${run}`,
      }),
    ).rejects.toThrow(/already carries that serial/i);
  });

  it("tracks the event's own cap across entries and standalone passes", async () => {
    const before = await organizer.caller.paddock.credentialsForEvent({
      eventId,
    });
    const paddock = before.issuance.find(
      (type) => type.typeId === paddockTypeId,
    )!;
    // One live entry pass (the other was voided) plus one standalone, against
    // a cap of 3. The voided one does not count towards the event's cap either.
    expect(paddock.issued).toBe(2);
    expect(paddock.remaining).toBe(1);
    expect(paddock.exhausted).toBe(false);

    await organizer.caller.paddock.issueStandaloneCredential({
      eventId,
      credentialTypeId: paddockTypeId,
      holderName: "Series photographer",
    });
    const after = await organizer.caller.paddock.credentialsForEvent({
      eventId,
    });
    expect(
      after.issuance.find((type) => type.typeId === paddockTypeId)?.exhausted,
    ).toBe(true);
  });

  it("refuses to delete a pass type that has issued passes", async () => {
    await expect(
      organizer.caller.paddock.deleteCredentialType({
        credentialTypeId: paddockTypeId,
      }),
    ).rejects.toThrow(/Set the allowance to zero/i);
  });

  it("keeps standalone passes to officials", async () => {
    await expect(
      entrant.caller.paddock.issueStandaloneCredential({
        eventId,
        credentialTypeId: paddockTypeId,
        holderName: "Self-issued",
      }),
    ).rejects.toThrow(/permission/i);
  });
});
