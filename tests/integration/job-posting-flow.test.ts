import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  OpportunityType,
  PlatformRole,
  PrismaClient,
  TeamRole,
} from "@prisma/client";
import { createCaller } from "@/server/trpc/root";

/**
 * Posting a job, which is what people came here to do.
 *
 * The regression: posting on behalf of a team required an active Recruiter
 * subscription, and the check never asked whether the deployment had Stripe
 * keys. Without them there is no checkout and no webhook to write the
 * subscription row, so the feature was not gated — it was gone, and the error
 * pointed at a Billing page that could not help.
 *
 * These run with billing switched off, which is the shape of every deployment
 * that has not wired Stripe up. Opt in with RUN_DB_TESTS=1.
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
      platformRole: PlatformRole.ADMIN,
      profile: { create: { displayName: suffix } },
    },
  });
  return { user, caller: callerFor(user.authProviderId) };
}

describe.skipIf(!ENABLED)("posting opportunities (integration)", () => {
  const run = Date.now();
  const savedKey = process.env.STRIPE_SECRET_KEY;
  let manager: Awaited<ReturnType<typeof makeUser>>;
  let driver: Awaited<ReturnType<typeof makeUser>>;
  let teamId: string;

  beforeAll(async () => {
    delete process.env.STRIPE_SECRET_KEY;
    manager = await makeUser(`job_mgr_${run}`);
    driver = await makeUser(`job_drv_${run}`);
    const team = await manager.caller.team.create({ name: `Hiring ${run}` });
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
      where: { id: { in: [manager.user.id, driver.user.id] } },
    });
    await db.$disconnect();
  });

  it("posts a seat for a team on a deployment with no billing", async () => {
    const posting = await manager.caller.opportunity.create({
      type: OpportunityType.SEAT,
      title: "Bronze-rated driver, endurance season",
      description:
        "Six rounds, arrive-and-drive, we cover the car and the crew.",
      teamId,
    });
    expect(posting.postedByTeamId).toBe(teamId);
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

  it("reports the caller as entitled while there is nothing to buy", async () => {
    const status = await manager.caller.billing.status();
    expect(status.stripeConfigured).toBe(false);
    expect(status.entitlements.recruiter).toBe(true);
    // And is still honest about what is actually subscribed.
    expect(status.subscriptions).toEqual([]);
  });
});
