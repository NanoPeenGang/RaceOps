import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient, SeriesDiscipline, VolunteerRoleType } from "@prisma/client";
import { createCaller } from "@/server/trpc/root";

/**
 * End-to-end checks for the organizer module against a real Postgres.
 * Opt in with RUN_DB_TESTS=1 and a DATABASE_URL pointing at a scratch
 * database that has the migrations applied; skipped otherwise so CI (which
 * has no database) stays green.
 *
 *   createdb raceops_test && DATABASE_URL=... npx prisma migrate deploy
 *   RUN_DB_TESTS=1 DATABASE_URL=... npx vitest run tests/integration
 */
const ENABLED = process.env.RUN_DB_TESTS === "1";

const db = ENABLED ? new PrismaClient() : (null as unknown as PrismaClient);

/** A caller acting as the given Clerk identity. */
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

describe.skipIf(!ENABLED)("organizer module (integration)", () => {
  let organizer: Awaited<ReturnType<typeof makeUser>>;
  let entrantA: Awaited<ReturnType<typeof makeUser>>;
  let entrantB: Awaited<ReturnType<typeof makeUser>>;
  let volunteer1: Awaited<ReturnType<typeof makeUser>>;
  let volunteer2: Awaited<ReturnType<typeof makeUser>>;
  let seriesId: string;
  let eventId: string;
  const run = Date.now();

  beforeAll(async () => {
    organizer = await makeUser(`org_${run}`);
    entrantA = await makeUser(`entrantA_${run}`);
    entrantB = await makeUser(`entrantB_${run}`);
    volunteer1 = await makeUser(`vol1_${run}`);
    volunteer2 = await makeUser(`vol2_${run}`);

    const series = await organizer.caller.series.create({
      name: `Test Championship ${run}`,
      discipline: SeriesDiscipline.SIM,
      platform: "iRacing",
    });
    seriesId = series.id;

    // Capacity of 1 exercises the confirm/waitlist/promote path.
    const event = await organizer.caller.event.create({
      seriesId,
      name: "Round 1",
      date: new Date(Date.now() + 7 * 864e5),
      platform: "iRacing",
      entryCapacity: 1,
    });
    eventId = event.id;
  });

  afterAll(async () => {
    if (!ENABLED) return;
    await db.series.deleteMany({ where: { id: seriesId } });
    await db.user.deleteMany({
      where: { authProviderId: { in: [
        organizer.user.authProviderId,
        entrantA.user.authProviderId,
        entrantB.user.authProviderId,
        volunteer1.user.authProviderId,
        volunteer2.user.authProviderId,
      ] } },
    });
    await db.$disconnect();
  });

  it("creates the series with the creator as OWNER", async () => {
    const mine = await organizer.caller.series.mine();
    expect(mine.find((s) => s.id === seriesId)?.myRole).toBe("OWNER");
  });

  it("hides draft events from non-organizers", async () => {
    const asEntrant = await entrantA.caller.series.bySlug({
      slug: (await db.series.findUniqueOrThrow({ where: { id: seriesId } })).slug,
    });
    expect(asEntrant.events).toHaveLength(0);

    await expect(entrantA.caller.event.byId({ eventId })).rejects.toThrow();
  });

  it("refuses entries while the event is a draft", async () => {
    await expect(entrantA.caller.event.register({ eventId })).rejects.toThrow(
      /not open/i,
    );
  });

  it("accepts entries once published", async () => {
    await organizer.caller.event.setStatus({ eventId, status: "PUBLISHED" });
    const a = await entrantA.caller.event.register({ eventId, carNumber: "24" });
    const b = await entrantB.caller.event.register({ eventId, carNumber: "7" });
    expect(a.status).toBe("PENDING");
    expect(b.status).toBe("PENDING");
  });

  it("rejects a duplicate car number", async () => {
    const third = await makeUser(`dupe_${run}`);
    await expect(
      third.caller.event.register({ eventId, carNumber: "24" }),
    ).rejects.toThrow(/already taken/i);
    await db.user.delete({ where: { id: third.user.id } });
  });

  it("blocks non-organizers from the management endpoints", async () => {
    await expect(
      entrantA.caller.event.registrationsFor({ eventId }),
    ).rejects.toThrow(/permission/i);
    await expect(
      entrantA.caller.event.setStatus({ eventId, status: "COMPLETED" }),
    ).rejects.toThrow(/permission/i);
  });

  it("enforces entry capacity when confirming", async () => {
    const entries = await organizer.caller.event.registrationsFor({ eventId });
    const [first, second] = entries;

    await organizer.caller.event.setRegistrationStatus({
      registrationId: first.id,
      status: "CONFIRMED",
    });

    // Capacity is 1, so the second entry cannot be confirmed.
    await expect(
      organizer.caller.event.setRegistrationStatus({
        registrationId: second.id,
        status: "CONFIRMED",
      }),
    ).rejects.toThrow(/grid is full/i);

    await organizer.caller.event.setRegistrationStatus({
      registrationId: second.id,
      status: "WAITLISTED",
    });
  });

  it("promotes the waitlist when a confirmed entry withdraws", async () => {
    const entries = await organizer.caller.event.registrationsFor({ eventId });
    const confirmed = entries.find((e) => e.status === "CONFIRMED")!;
    const waitlisted = entries.find((e) => e.status === "WAITLISTED")!;

    const owner = confirmed.submittedById === entrantA.user.id ? entrantA : entrantB;
    await owner.caller.event.withdrawRegistration({
      registrationId: confirmed.id,
    });

    const after = await organizer.caller.event.registrationsFor({ eventId });
    expect(after.find((e) => e.id === waitlisted.id)?.status).toBe("CONFIRMED");
    expect(after.find((e) => e.id === confirmed.id)?.status).toBe("WITHDRAWN");
  });

  it("waitlists volunteers past shift capacity and promotes on cancel", async () => {
    const shift = await organizer.caller.event.createShift({
      eventId,
      role: VolunteerRoleType.MARSHAL,
      title: "Turn 5",
      startsAt: new Date(Date.now() + 7 * 864e5),
      endsAt: new Date(Date.now() + 7 * 864e5 + 3600e3),
      capacity: 1,
    });

    const first = await volunteer1.caller.event.volunteerSignUp({
      shiftId: shift.id,
    });
    const second = await volunteer2.caller.event.volunteerSignUp({
      shiftId: shift.id,
    });
    expect(first.status).toBe("SIGNED_UP");
    expect(second.status).toBe("WAITLISTED");

    await volunteer1.caller.event.volunteerCancel({ shiftId: shift.id });

    const shifts = await organizer.caller.event.shiftsFor({ eventId });
    const signups = shifts.find((s) => s.id === shift.id)!.signups;
    expect(
      signups.find((s) => s.userId === volunteer2.user.id)?.status,
    ).toBe("SIGNED_UP");
  });

  it("notifies the entrant when their entry status changes", async () => {
    const notifications = await entrantB.caller.notification.list({});
    expect(notifications.items.length).toBeGreaterThan(0);
  });
});
