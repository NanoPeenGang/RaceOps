import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  OrgRole,
  Permission,
  PlatformRole,
  PrismaClient,
  SeriesDiscipline,
} from "@prisma/client";
import { createCaller } from "@/server/trpc/root";

/** Organizations, custom staff roles, and the escalation guards. */
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

describe.skipIf(!ENABLED)("organizations & staff roles (integration)", () => {
  const run = Date.now();
  let owner: Awaited<ReturnType<typeof makeUser>>;
  let admin: Awaited<ReturnType<typeof makeUser>>;
  let scrutineer: Awaited<ReturnType<typeof makeUser>>;
  let outsider: Awaited<ReturnType<typeof makeUser>>;
  let orgId: string;
  let seriesId: string;
  let eventId: string;
  let scrutineerRoleId: string;

  beforeAll(async () => {
    owner = await makeUser(`orgown_${run}`);
    admin = await makeUser(`orgadm_${run}`);
    scrutineer = await makeUser(`orgscr_${run}`);
    outsider = await makeUser(`orgout_${run}`);

    const organization = await owner.caller.organization.create({
      name: `Apex Motorsport Club ${run}`,
      location: "Somewhere",
    });
    orgId = organization.id;

    const series = await owner.caller.series.create({
      name: `Club Championship ${run}`,
      discipline: SeriesDiscipline.REAL_WORLD,
      platform: "Circuit",
    });
    seriesId = series.id;
    await owner.caller.organization.adoptSeries({
      organizationId: orgId,
      seriesId,
    });

    const event = await owner.caller.event.create({
      seriesId,
      name: "Round 1",
      date: new Date(Date.now() + 864e5),
      platform: "Circuit",
    });
    eventId = event.id;
  });

  afterAll(async () => {
    if (ENABLED) await db.$disconnect();
  });

  it("seeds starter roles so a new organization is usable at once", async () => {
    const staff = await owner.caller.organization.staff({
      organizationId: orgId,
    });
    expect(staff.roles.length).toBeGreaterThan(3);
    expect(staff.roles.map((role) => role.name)).toContain("Chief Scrutineer");
    scrutineerRoleId = staff.roles.find(
      (role) => role.name === "Chief Scrutineer",
    )!.id;
  });

  it("gives a plain staff member nothing until a role is assigned", async () => {
    await owner.caller.organization.addMember({
      organizationId: orgId,
      email: scrutineer.user.email,
      role: OrgRole.STAFF,
      title: "Chief Scrutineer",
    });

    // Belonging to the organization is not itself a permission.
    await expect(
      scrutineer.caller.session.create({
        eventId,
        type: "SCRUTINEERING",
        name: "Tech",
        startsAt: new Date(Date.now() + 864e5),
        endsAt: new Date(Date.now() + 864e5 + 3_600_000),
      }),
    ).rejects.toThrow(/permission/i);
  });

  it("grants access through a custom role, with no series membership", async () => {
    await owner.caller.organization.assignRole({
      staffRoleId: scrutineerRoleId,
      userId: scrutineer.user.id,
    });

    const session = await scrutineer.caller.session.create({
      eventId,
      type: "SCRUTINEERING",
      name: "Tech inspection",
      startsAt: new Date(Date.now() + 864e5),
      endsAt: new Date(Date.now() + 864e5 + 3_600_000),
    });
    expect(session.name).toBe("Tech inspection");

    // They were never added to the series roster — the role alone did it.
    const membership = await db.seriesMembership.findUnique({
      where: { seriesId_userId: { seriesId, userId: scrutineer.user.id } },
    });
    expect(membership).toBeNull();
  });

  it("does not let a narrow role reach what it was not granted", async () => {
    // "Chief Scrutineer" holds EVENT_MANAGE but not SERIES_MANAGE. The union
    // of an admin's permissions contains EVENT_MANAGE, so a system that
    // derived access from "admins can do this too" would wrongly allow it.
    await expect(
      scrutineer.caller.series.update({
        seriesId,
        description: "Rewriting the championship",
      }),
    ).rejects.toThrow(/permission/i);
  });

  it("refuses to grant a permission the granter does not hold", async () => {
    // Otherwise ORG_STAFF_MANAGE is a two-click path to everything: create
    // "Superuser", assign it to yourself.
    await owner.caller.organization.addMember({
      organizationId: orgId,
      email: admin.user.email,
      role: OrgRole.STAFF,
    });
    const staffManager = await owner.caller.organization.createRole({
      organizationId: orgId,
      name: "Staff Manager",
      permissions: [Permission.ORG_STAFF_MANAGE],
    });
    await owner.caller.organization.assignRole({
      staffRoleId: staffManager.id,
      userId: admin.user.id,
    });

    await expect(
      admin.caller.organization.createRole({
        organizationId: orgId,
        name: "Superuser",
        permissions: [Permission.ORG_MANAGE, Permission.SERIES_MANAGE],
      }),
    ).rejects.toThrow(/cannot grant a permission you do not hold/i);

    // They can still create a role within what they hold.
    const allowed = await admin.caller.organization.createRole({
      organizationId: orgId,
      name: "Deputy Staff Manager",
      permissions: [Permission.ORG_STAFF_MANAGE],
    });
    expect(allowed.name).toBe("Deputy Staff Manager");
  });

  it("keeps series deletion an ownership act no role can reach", async () => {
    const superRole = await owner.caller.organization.createRole({
      organizationId: orgId,
      name: "Everything",
      permissions: Object.values(Permission),
    });
    await owner.caller.organization.assignRole({
      staffRoleId: superRole.id,
      userId: outsider.user.id,
    });

    // Every permission there is, and still not the owner of the series.
    await expect(
      outsider.caller.series.delete({
        seriesId,
        confirmName: `Club Championship ${run}`,
      }),
    ).rejects.toThrow(/Ownership cannot be delegated/i);
  });

  it("narrows an assignment to a single event", async () => {
    const marshal = await makeUser(`orgmar_${run}`);
    const oneOff = await owner.caller.organization.createRole({
      organizationId: orgId,
      name: "Guest Clerk",
      permissions: [Permission.EVENT_MANAGE],
    });
    await owner.caller.organization.assignRole({
      staffRoleId: oneOff.id,
      userId: marshal.user.id,
      eventId,
    });

    // Reaches the round they were hired for.
    await marshal.caller.log.add({ eventId, summary: "Briefing held" });

    // Not the next one.
    const round2 = await owner.caller.event.create({
      seriesId,
      name: "Round 2",
      date: new Date(Date.now() + 2 * 864e5),
      platform: "Circuit",
    });
    await expect(
      marshal.caller.log.add({
        eventId: round2.id,
        summary: "Should not reach this",
      }),
    ).rejects.toThrow(/permission/i);
  });

  it("refuses to remove the last owner", async () => {
    const staff = await owner.caller.organization.staff({
      organizationId: orgId,
    });
    const ownerMembership = staff.members.find(
      (member) => member.role === OrgRole.OWNER,
    )!;
    await expect(
      owner.caller.organization.removeMember({
        membershipId: ownerMembership.id,
      }),
    ).rejects.toThrow(/last owner/i);
  });

  it("refuses to delete a role people still hold", async () => {
    await expect(
      owner.caller.organization.deleteRole({ staffRoleId: scrutineerRoleId }),
    ).rejects.toThrow(/Unassign them first/i);
  });

  it("detaches series rather than deleting them with the organization", async () => {
    const doomed = await owner.caller.organization.create({
      name: `Folding Club ${run}`,
    });
    const orphan = await owner.caller.series.create({
      name: `Orphan Cup ${run}`,
      discipline: SeriesDiscipline.SIM,
      platform: "iRacing",
    });
    await owner.caller.organization.adoptSeries({
      organizationId: doomed.id,
      seriesId: orphan.id,
    });

    const result = await owner.caller.organization.delete({
      organizationId: doomed.id,
      confirmName: `Folding Club ${run}`,
    });
    expect(result.detachedSeries).toBe(1);

    // Losing a championship because someone tidied up the company that ran it
    // would be indefensible.
    const survivor = await db.series.findUnique({ where: { id: orphan.id } });
    expect(survivor).not.toBeNull();
    expect(survivor?.organizationId).toBeNull();
  });

  it("keeps the staff list to people who manage staff", async () => {
    await expect(
      scrutineer.caller.organization.staff({ organizationId: orgId }),
    ).rejects.toThrow(/permission/i);
  });
});
