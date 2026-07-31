import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AccessZone,
  CredentialAudience,
  CredentialStatus,
  PrismaClient,
  RegistrationStatus,
  SeriesDiscipline,
} from "@prisma/client";
import { createCaller } from "@/server/trpc/root";
import { isValidPass, zoneSummary } from "@/lib/credentials";
import { credentialUrl, qrSvg } from "@/server/services/qr";
import { buildPassJson } from "@/lib/wallet";

/**
 * Auto-generated accreditation, end to end.
 *
 * The properties that matter are that a sweep names everybody exactly once,
 * that the QR code on a badge resolves to that person's details without the
 * scanner needing an account, and that a cancelled pass stops working
 * immediately. Opt in with RUN_DB_TESTS=1.
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

describe.skipIf(!ENABLED)("credential generation (integration)", () => {
  const run = Date.now();
  let organizer: Awaited<ReturnType<typeof makeUser>>;
  let driver: Awaited<ReturnType<typeof makeUser>>;
  let coDriver: Awaited<ReturnType<typeof makeUser>>;
  let stranger: Awaited<ReturnType<typeof makeUser>>;
  let seriesId: string;
  let eventId: string;
  let driverTypeId: string;
  let officialTypeId: string;

  beforeAll(async () => {
    organizer = await makeUser(`credorg_${run}`);
    driver = await makeUser(`creddrv_${run}`);
    coDriver = await makeUser(`credco_${run}`);
    stranger = await makeUser(`credout_${run}`);

    const series = await organizer.caller.series.create({
      name: `Credential Cup ${run}`,
      discipline: SeriesDiscipline.REAL_WORLD,
      platform: "Circuit",
    });
    seriesId = series.id;

    const event = await organizer.caller.event.create({
      seriesId,
      name: "Round 1",
      date: new Date(Date.UTC(2026, 8, 1, 9, 0)),
      platform: "Circuit",
    });
    eventId = event.id;
    await organizer.caller.event.setStatus({ eventId, status: "PUBLISHED" });

    const registration = await driver.caller.event.register({
      eventId,
      carNumber: "24",
    });
    await organizer.caller.event.setRegistrationStatus({
      registrationId: registration.id,
      status: RegistrationStatus.CONFIRMED,
    });
    await driver.caller.lineup.addDriver({
      registrationId: registration.id,
      userId: coDriver.user.id,
    });

    const driverType = await organizer.caller.paddock.addCredentialType({
      eventId,
      name: "Competitor",
      allowancePerEntry: 4,
      zones: [AccessZone.PADDOCK, AccessZone.PIT_LANE, AccessZone.GRID],
      autoIssueTo: CredentialAudience.DRIVER,
    });
    driverTypeId = driverType.id;

    const officialType = await organizer.caller.paddock.addCredentialType({
      eventId,
      name: "Official",
      zones: [AccessZone.PADDOCK, AccessZone.RACE_CONTROL],
      autoIssueTo: CredentialAudience.ORGANIZER,
    });
    officialTypeId = officialType.id;
  });

  afterAll(async () => {
    if (!ENABLED) return;
    await db.raceEvent.deleteMany({ where: { seriesId } });
    await db.series.deleteMany({ where: { id: seriesId } });
    await db.user.deleteMany({
      where: {
        id: {
          in: [
            organizer.user.id,
            driver.user.id,
            coDriver.user.id,
            stranger.user.id,
          ],
        },
      },
    });
    await db.$disconnect();
  });

  it("previews who would get what before anything is written", async () => {
    const { plan } = await organizer.caller.paddock.previewCredentialSweep({
      eventId,
    });
    const names = plan.toIssue.map((entry) => entry.candidate.name);
    expect(names).toContain(`credco_${run}`);
    expect(names).toContain(`credorg_${run}`);
    // Nothing has been created yet — that is what makes it a preview.
    expect(await db.credential.count({ where: { eventId } })).toBe(0);
  });

  it("names the person who would get nothing rather than dropping them", async () => {
    /*
     * The entrant registered but is not in the driver line-up, so they are an
     * ENTRANT — and no pass type is configured for entrants. This is the
     * silent failure the feature exists to prevent: without the unmatched
     * list, that person turns up on Saturday with nothing and appears in no
     * error message anywhere.
     */
    const { plan } = await organizer.caller.paddock.previewCredentialSweep({
      eventId,
    });
    expect(plan.unmatched.map((c) => c.name)).toContain(`creddrv_${run}`);
    expect(plan.unmatched.map((c) => c.audience)).toContain(
      CredentialAudience.ENTRANT,
    );
  });

  it("picks them up once a type covers their audience", async () => {
    await organizer.caller.paddock.addCredentialType({
      eventId,
      name: "Entrant",
      zones: [AccessZone.PADDOCK],
      autoIssueTo: CredentialAudience.ENTRANT,
    });
    const { plan } = await organizer.caller.paddock.previewCredentialSweep({
      eventId,
    });
    expect(plan.toIssue.map((entry) => entry.candidate.name)).toContain(
      `creddrv_${run}`,
    );
    expect(plan.unmatched).toEqual([]);
  });

  it("carries the entry's team and car number onto the plan", async () => {
    const { plan } = await organizer.caller.paddock.previewCredentialSweep({
      eventId,
    });
    const entry = plan.toIssue.find(
      (item) => item.candidate.name === `credco_${run}`,
    );
    expect(entry?.candidate.carNumber).toBe("24");
    expect(entry?.candidate.registrationId).toBeTruthy();
  });

  it("issues every pass with a QR code", async () => {
    const result = await organizer.caller.paddock.generateCredentials({
      eventId,
    });
    expect(result.created).toBeGreaterThanOrEqual(3);

    const credentials = await db.credential.findMany({ where: { eventId } });
    expect(credentials.every((pass) => pass.qrToken)).toBe(true);
    expect(credentials.every((pass) => isValidPass(pass.status))).toBe(true);
    // Tokens are unguessable and distinct.
    expect(new Set(credentials.map((p) => p.qrToken)).size).toBe(
      credentials.length,
    );
    expect(credentials[0].qrToken!.length).toBeGreaterThanOrEqual(24);
  });

  it("adds nothing on a second sweep", async () => {
    const before = await db.credential.count({ where: { eventId } });
    const again = await organizer.caller.paddock.generateCredentials({
      eventId,
    });
    expect(again.created).toBe(0);
    expect(await db.credential.count({ where: { eventId } })).toBe(before);
  });

  it("resolves a scanned code for somebody with no account at all", async () => {
    /*
     * The scanner is a marshal on a gate at 07:00 with a phone. A check that
     * only works when signed in is a check nobody performs, so this procedure
     * is public — safe because the token is 24 random bytes and shows only
     * what the badge already prints.
     */
    const pass = await db.credential.findFirstOrThrow({
      where: { eventId, credentialTypeId: driverTypeId },
    });
    const anonymous = callerFor(null);
    const scanned = await anonymous.paddock.scanCredential({
      token: pass.qrToken!,
    });

    expect(scanned.holderName).toBe(pass.holderName);
    expect(scanned.holderRole).toBeTruthy();
    expect(scanned.credentialType.name).toBe("Competitor");
    expect(zoneSummary(scanned.credentialType.zones)).toBe(
      "Paddock · Pit lane · Grid",
    );
    expect(scanned.event.name).toBe("Round 1");
    expect(isValidPass(scanned.status)).toBe(true);
  });

  it("shows the entry a competitor is attached to", async () => {
    const pass = await db.credential.findFirstOrThrow({
      where: { eventId, credentialTypeId: driverTypeId, registrationId: { not: null } },
    });
    const scanned = await callerFor(null).paddock.scanCredential({
      token: pass.qrToken!,
    });
    expect(scanned.registration?.carNumber).toBe("24");
  });

  it("refuses a code that is not one of ours", async () => {
    await expect(
      callerFor(null).paddock.scanCredential({ token: "not-a-real-token-xx" }),
    ).rejects.toThrow(/not one issued here/i);
  });

  it("stops a voided pass from scanning as valid", async () => {
    const pass = await db.credential.findFirstOrThrow({
      where: { eventId, credentialTypeId: officialTypeId },
    });
    await organizer.caller.paddock.setCredentialStatus({
      credentialId: pass.id,
      status: CredentialStatus.VOID,
    });

    const scanned = await callerFor(null).paddock.scanCredential({
      token: pass.qrToken!,
    });
    // The pass still resolves — a marshal needs to be told *why* it fails,
    // not shown a "not found" they have to interpret.
    expect(scanned.holderName).toBeTruthy();
    expect(isValidPass(scanned.status)).toBe(false);
  });

  it("kills a lost badge's code without losing its history", async () => {
    const pass = await db.credential.findFirstOrThrow({
      where: { eventId, credentialTypeId: driverTypeId },
    });
    const oldToken = pass.qrToken!;

    const rotated = await organizer.caller.paddock.refreshCredentialToken({
      credentialId: pass.id,
    });
    expect(rotated.qrToken).not.toBe(oldToken);
    expect(rotated.id).toBe(pass.id);
    expect(rotated.issuedAt).toEqual(pass.issuedAt);

    await expect(
      callerFor(null).paddock.scanCredential({ token: oldToken }),
    ).rejects.toThrow(/not one issued here/i);
  });

  it("keeps the badge sheet to organizers", async () => {
    // A sheet of scannable passes is a sheet of working credentials.
    await expect(
      stranger.caller.document.credentialSheet({ eventId }),
    ).rejects.toThrow();

    const sheet = await organizer.caller.document.credentialSheet({ eventId });
    expect(sheet.badges.length).toBeGreaterThan(0);
    expect(sheet.withoutCode).toBe(0);
  });

  it("renders a scannable QR into each badge", async () => {
    const sheet = await organizer.caller.document.credentialSheet({ eventId });
    const badge = sheet.badges[0];
    expect(badge.qr).toContain("<svg");
    expect(badge.url).toContain("/pass/");
    // The code encodes the URL a phone will open, not the row id.
    expect(badge.url).not.toContain(badge.credentialId);
  });

  it("leaves a requested pass off the printed sheet", async () => {
    /*
     * A requested-but-not-issued pass on a lanyard is worse than none: it
     * scans as "do not admit" while looking exactly like a working badge, and
     * the holder has no way to know.
     */
    const registration = await db.eventRegistration.findFirstOrThrow({
      where: { eventId },
    });
    const requested = await driver.caller.paddock.requestCredential({
      registrationId: registration.id,
      credentialTypeId: driverTypeId,
      holderName: `Mechanic ${run}`,
      holderRole: "Mechanic",
    });
    expect(requested.status).toBe(CredentialStatus.REQUESTED);
    expect(requested.qrToken).toBeNull();

    const sheet = await organizer.caller.document.credentialSheet({ eventId });
    expect(sheet.badges.map((b) => b.holderName)).not.toContain(
      `Mechanic ${run}`,
    );

    // Issuing it mints the code and puts it on the sheet.
    await organizer.caller.paddock.setCredentialStatus({
      credentialId: requested.id,
      status: CredentialStatus.ISSUED,
    });
    const after = await organizer.caller.document.credentialSheet({ eventId });
    const badge = after.badges.find((b) => b.holderName === `Mechanic ${run}`);
    expect(badge?.qr).toContain("<svg");
  });

  it("puts a person's own passes in front of them", async () => {
    /*
     * The whole point of accreditation is arriving at a gate with the right
     * thing in hand. Making somebody remember which event page it was on, at
     * a circuit with patchy signal, is how they end up queueing at the desk
     * for a pass issued three weeks ago.
     */
    const mine = await coDriver.caller.paddock.myCredentials();
    expect(mine.credentials).toHaveLength(1);
    expect(mine.credentials[0].credentialType.name).toBe("Competitor");
    expect(mine.credentials[0].qrToken).toBeTruthy();
    expect(mine.credentials[0].event.name).toBe("Round 1");
    expect(mine.credentials[0].registration?.carNumber).toBe("24");
  });

  it("shows nobody a pass that is not theirs", async () => {
    expect((await stranger.caller.paddock.myCredentials()).credentials).toEqual(
      [],
    );

    const someoneElses = await db.credential.findFirstOrThrow({
      where: { eventId, holderUserId: coDriver.user.id },
    });
    // NOT_FOUND rather than FORBIDDEN: whether an id is a pass at all is not
    // something to confirm to somebody it does not belong to.
    await expect(
      stranger.caller.paddock.myCredential({ credentialId: someoneElses.id }),
    ).rejects.toThrow(/NOT_FOUND|not found/i);
  });

  it("keeps a voided pass out of the holder's own list", async () => {
    // A cancelled pass on somebody's phone is a card they wave at a gate in
    // poor light. Better it is not there at all.
    const pass = await db.credential.findFirstOrThrow({
      where: { eventId, holderUserId: coDriver.user.id },
    });
    await organizer.caller.paddock.setCredentialStatus({
      credentialId: pass.id,
      status: CredentialStatus.VOID,
    });
    expect(
      (await coDriver.caller.paddock.myCredentials()).credentials,
    ).toEqual([]);

    await organizer.caller.paddock.setCredentialStatus({
      credentialId: pass.id,
      status: CredentialStatus.ISSUED,
    });
  });

  it("builds a wallet pass from what the holder actually holds", async () => {
    const mine = await coDriver.caller.paddock.myCredentials();
    const pass = mine.credentials[0];
    const json = buildPassJson(
      {
        token: pass.qrToken!,
        holderName: pass.holderName,
        holderRole: pass.holderRole,
        typeName: pass.credentialType.name,
        zones: pass.credentialType.zones,
        teamName: pass.registration?.team?.name ?? null,
        carNumber: pass.registration?.carNumber ?? null,
        serial: pass.serial,
        status: pass.status,
        eventName: pass.event.name,
        seriesName: pass.event.series?.name ?? null,
        eventDate: pass.event.date,
        venue: null,
        url: credentialUrl(pass.qrToken!),
      },
      {
        passTypeIdentifier: "pass.test",
        teamIdentifier: "TEAM1",
        organizationName: "RaceOps",
      },
    );
    // The barcode resolves to the same place the printed badge's does.
    expect((json.barcodes as { message: string }[])[0].message).toContain(
      pass.qrToken!,
    );
    expect(json.serialNumber).toBe(pass.qrToken);
  });

  it("tells the UI whether Wallet can be offered at all", async () => {
    // No Apple certificates in this environment, so the button must not be
    // rendered — a download the phone silently refuses is worse than no
    // button, because the person believes they have a pass.
    const mine = await coDriver.caller.paddock.myCredentials();
    expect(typeof mine.walletAvailable).toBe("boolean");
    expect(mine.walletAvailable).toBe(false);
  });

  it("will not let an outsider sweep or scan-manage an event", async () => {
    await expect(
      stranger.caller.paddock.generateCredentials({ eventId }),
    ).rejects.toThrow();
    await expect(
      stranger.caller.paddock.previewCredentialSweep({ eventId }),
    ).rejects.toThrow();
  });
});

describe("QR rendering", () => {
  it("produces an SVG that carries the URL's data", async () => {
    const svg = await qrSvg("https://example.test/pass/abc123");
    expect(svg).toContain("<svg");
    expect(svg).toContain("viewBox");
    // A QR is drawn as paths; an empty one would be a blank square.
    expect(svg).toContain("<path");
  });

  it("builds an absolute URL when the app URL is configured", () => {
    const previous = process.env.NEXT_PUBLIC_APP_URL;
    process.env.NEXT_PUBLIC_APP_URL = "https://raceops.test/";
    expect(credentialUrl("abc")).toBe("https://raceops.test/pass/abc");
    // A QR is scanned by a phone with no idea what origin printed the badge,
    // so a relative path is the fallback rather than the norm.
    delete process.env.NEXT_PUBLIC_APP_URL;
    expect(credentialUrl("abc")).toBe("/pass/abc");
    if (previous !== undefined) process.env.NEXT_PUBLIC_APP_URL = previous;
  });
});
