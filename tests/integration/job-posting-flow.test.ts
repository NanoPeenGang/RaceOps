import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AccessRequestKind,
  OpportunityType,
  PlatformRole,
  PrismaClient,
  TeamRole,
} from "@prisma/client";
import { createCaller } from "@/server/trpc/root";

/**
 * Posting a job, which is what people came here to do.
 *
 * While the platform is in testing this is gated by an application to the
 * platform admins rather than by a subscription. The rule that matters is the
 * scope: approval attaches to the **team**, not to whoever asked for it, so a
 * manager who applies and then leaves does not take the team's ability to hire
 * with them, and being approved for one team is not a licence to post for
 * another.
 *
 * Opt in with RUN_DB_TESTS=1.
 */
const ENABLED = process.env.RUN_DB_TESTS === "1";
const db = ENABLED ? new PrismaClient() : (null as unknown as PrismaClient);

function callerFor(clerkUserId: string | null) {
  return createCaller({ db, clerkUserId, headers: new Headers() });
}

/**
 * Ordinary members by default.
 *
 * Deliberately *not* the platform-admin fixture the other suites use: staff
 * bypass every access gate, so a manager with an admin role would pass these
 * tests without the feature working at all.
 */
async function makeUser(
  suffix: string,
  platformRole: PlatformRole = PlatformRole.MEMBER,
) {
  const user = await db.user.create({
    data: {
      email: `${suffix}@example.test`,
      authProviderId: `clerk_${suffix}`,
      platformRole,
      profile: { create: { displayName: suffix } },
    },
  });
  return { user, caller: callerFor(user.authProviderId) };
}

/** Teams made directly: creating one is its own gate and not what is under test. */
async function makeTeam(name: string, ownerId: string, organizationId?: string) {
  return db.team.create({
    data: {
      name,
      slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      organizationId,
      roster: { create: { userId: ownerId, role: TeamRole.OWNER } },
    },
  });
}

describe.skipIf(!ENABLED)("posting opportunities (integration)", () => {
  const run = Date.now();
  const savedKey = process.env.STRIPE_SECRET_KEY;
  let manager: Awaited<ReturnType<typeof makeUser>>;
  let driver: Awaited<ReturnType<typeof makeUser>>;
  let admin: Awaited<ReturnType<typeof makeUser>>;
  let teamId: string;

  beforeAll(async () => {
    delete process.env.STRIPE_SECRET_KEY;
    manager = await makeUser(`job_mgr_${run}`);
    driver = await makeUser(`job_drv_${run}`);
    admin = await makeUser(`job_adm_${run}`, PlatformRole.ADMIN);
    const team = await makeTeam(`Hiring ${run}`, manager.user.id);
    teamId = team.id;
    await db.teamMembership.create({
      data: { teamId, userId: driver.user.id, role: TeamRole.DRIVER },
    });
  });

  afterAll(async () => {
    if (!ENABLED) return;
    if (savedKey === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = savedKey;
    await db.opportunity.deleteMany({ where: { postedByTeamId: teamId } });
    await db.opportunity.deleteMany({
      where: { postedByUserId: { in: [manager.user.id, driver.user.id] } },
    });
    await db.team.deleteMany({ where: { id: teamId } });
    await db.user.deleteMany({
      where: { id: { in: [manager.user.id, driver.user.id, admin.user.id] } },
    });
    await db.$disconnect();
  });

  it("refuses a team advert until the team has been approved", async () => {
    await expect(
      manager.caller.opportunity.create({
        type: OpportunityType.SEAT,
        title: "Bronze-rated driver, endurance season",
        description:
          "Six rounds, arrive-and-drive, we cover the car and the crew.",
        teamId,
      }),
    ).rejects.toThrow(/approval for this team/i);
  });

  it("will not let somebody apply on behalf of a team they only drive for", async () => {
    // Without this, anybody could apply for any team and an approving admin
    // would have no way of telling — the application would look identical.
    await expect(
      driver.caller.access.submit({
        kind: AccessRequestKind.RECRUITING,
        proposedName: `Hiring ${run}`,
        summary: "Applying for a team I have nothing to do with.",
        subjectTeamId: teamId,
      }),
    ).rejects.toThrow(/owner or managers/i);
  });

  it("wants to know which body a recruiting application is for", async () => {
    await expect(
      manager.caller.access.submit({
        kind: AccessRequestKind.RECRUITING,
        proposedName: `Hiring ${run}`,
        summary: "A recruiting application with no subject on it at all.",
      }),
    ).rejects.toThrow(/which team or organization/i);
  });

  it("posts once an admin approves the team", async () => {
    const request = await manager.caller.access.submit({
      kind: AccessRequestKind.RECRUITING,
      proposedName: `Hiring ${run}`,
      summary:
        "We run two cars in club endurance and need a fourth driver for the season.",
      subjectTeamId: teamId,
    });
    expect(request.subjectTeamId).toBe(teamId);

    await admin.caller.access.decide({ requestId: request.id, approve: true });

    const posting = await manager.caller.opportunity.create({
      type: OpportunityType.SEAT,
      title: "Bronze-rated driver, endurance season",
      description:
        "Six rounds, arrive-and-drive, we cover the car and the crew.",
      teamId,
    });
    expect(posting.postedByTeamId).toBe(teamId);
  });

  it("does not spend the approval on the first advert", async () => {
    // A team that hires once will hire again; consuming it would mean
    // re-applying every time somebody leaves.
    const second = await manager.caller.opportunity.create({
      type: OpportunityType.CREW_JOB,
      title: "Number two mechanic",
      description: "Weekends away, expenses covered, tools provided.",
      teamId,
    });
    expect(second.postedByTeamId).toBe(teamId);
  });

  it("does not carry the approval across to another team", async () => {
    const other = await makeTeam(`Unapproved ${run}`, manager.user.id);
    await expect(
      manager.caller.opportunity.create({
        type: OpportunityType.SEAT,
        title: "A seat at a team nobody approved",
        description: "Should be refused however many other teams are approved.",
        teamId: other.id,
      }),
    ).rejects.toThrow(/approval for this team/i);
    await db.team.delete({ where: { id: other.id } });
  });

  it("lets a team inside an approved organization post without its own application", async () => {
    /*
     * A club approved to recruit should not have to approve each of its teams
     * separately — that is the same conversation five times.
     */
    const org = await admin.caller.organization.create({
      name: `Approved Club ${run}`,
    });
    const child = await makeTeam(`Club Team ${run}`, manager.user.id, org.id);

    await expect(
      manager.caller.opportunity.create({
        type: OpportunityType.SEAT,
        title: "Before the club was approved",
        description: "Should be refused until the organization is approved.",
        teamId: child.id,
      }),
    ).rejects.toThrow(/approval for this team/i);

    const request = await admin.caller.access.submit({
      kind: AccessRequestKind.RECRUITING,
      proposedName: `Approved Club ${run}`,
      summary: "The club hires on behalf of every team that runs under it.",
      subjectOrganizationId: org.id,
    });
    await admin.caller.access.decide({ requestId: request.id, approve: true });

    const posting = await manager.caller.opportunity.create({
      type: OpportunityType.SEAT,
      title: "After the club was approved",
      description: "Inherited from the organization the team runs under.",
      teamId: child.id,
    });
    expect(posting.postedByTeamId).toBe(child.id);

    await db.team.delete({ where: { id: child.id } });
  });

  it("still posts as an individual, which was never gated", async () => {
    const posting = await driver.caller.opportunity.create({
      type: OpportunityType.CREW_JOB,
      title: "Available as a number two mechanic",
      description: "Weekends, own tools, happy to travel for the right team.",
    });
    expect(posting.postedByUserId).toBe(driver.user.id);
    expect(posting.postedByTeamId).toBeNull();
  });

  it("keeps team posting to the people who run the team", async () => {
    // Billing being off removes the paywall, not the permission model.
    await expect(
      driver.caller.opportunity.create({
        type: OpportunityType.CREW_JOB,
        title: "Posting on behalf of a team I only drive for",
        description: "Should not be allowed regardless of any subscription.",
        teamId,
      }),
    ).rejects.toThrow(/owners\/managers/i);
  });

  it("no longer asks about a subscription at all", async () => {
    // The tier machinery is left standing so charging for this again is a
    // one-line change, but it is not what gates the feature today.
    const status = await manager.caller.billing.status();
    expect(status.subscriptions).toEqual([]);
    const posting = await manager.caller.opportunity.create({
      type: OpportunityType.CREW_JOB,
      title: "Posted with nothing subscribed",
      description: "The gate is the application, not the payment.",
      teamId,
    });
    expect(posting.postedByTeamId).toBe(teamId);
  });
});
