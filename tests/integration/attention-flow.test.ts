import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ApplicationStatus,
  InterviewStatus,
  PartCategory,
  PayBasis,
  PayRunStatus,
  PrismaClient,
  ServiceStatus,
  TeamRole,
} from "@prisma/client";
import { createCaller } from "@/server/trpc/root";
import { teamAttention } from "@/server/services/team-attention";
import { STALE_AFTER_DAYS } from "@/lib/hiring";

/**
 * The attention rollup that drives the console tab badges and the home
 * dashboard strip.
 *
 * Three things worth proving: the counts are right, a driver cannot read them,
 * and computing them for many teams stays a fixed number of queries — the home
 * page asks this for every team somebody manages, so a loop here would undo
 * the N+1 work. Opt in with RUN_DB_TESTS=1.
 */
const ENABLED = process.env.RUN_DB_TESTS === "1";
const base = ENABLED ? new PrismaClient() : (null as unknown as PrismaClient);

function counting() {
  let queries = 0;
  const extended = base.$extends({
    query: {
      $allModels: {
        async $allOperations({ args, query }) {
          queries += 1;
          return query(args);
        },
      },
    },
  });
  return {
    db: extended as unknown as PrismaClient,
    reset: () => {
      queries = 0;
    },
    count: () => queries,
  };
}

describe.skipIf(!ENABLED)("team attention (integration)", () => {
  const run = Date.now();
  const userIds: string[] = [];
  const teamIds: string[] = [];
  let teamId: string;
  let teamSlug: string;
  let managerAuthId: string;
  let driverAuthId: string;
  let managerId: string;

  async function makeTeam(label: string) {
    const team = await base.team.create({
      data: { name: `${label} ${run}`, slug: `${label}-${run}`.toLowerCase() },
    });
    teamIds.push(team.id);
    return team;
  }

  beforeAll(async () => {
    if (!ENABLED) return;
    const team = await makeTeam("attention");
    teamId = team.id;
    teamSlug = team.slug;

    const manager = await base.user.create({
      data: {
        email: `amanager_${run}@example.test`,
        authProviderId: `clerk_amanager_${run}`,
        profile: { create: { displayName: "amanager" } },
      },
    });
    const driver = await base.user.create({
      data: {
        email: `adriver_${run}@example.test`,
        authProviderId: `clerk_adriver_${run}`,
        profile: { create: { displayName: "adriver" } },
      },
    });
    userIds.push(manager.id, driver.id);
    managerId = manager.id;
    managerAuthId = manager.authProviderId;
    driverAuthId = driver.authProviderId;

    await base.teamMembership.createMany({
      data: [
        { teamId, userId: manager.id, role: TeamRole.OWNER },
        { teamId, userId: driver.id, role: TeamRole.DRIVER },
      ],
    });
  });

  afterAll(async () => {
    if (!ENABLED) return;
    await base.team.deleteMany({ where: { id: { in: teamIds } } });
    await base.user.deleteMany({ where: { id: { in: userIds } } });
    await base.$disconnect();
  });

  it("is all zeros for a team with nothing outstanding", async () => {
    const map = await teamAttention(base, [
      { id: teamId, name: "attention", slug: teamSlug },
    ]);
    const row = map.get(teamId)!;
    expect(row.newApplications).toBe(0);
    expect(row.overdueServices).toBe(0);
    expect(row.payRunsToApprove).toBe(0);
    expect(row.lowStock).toBe(0);
  });

  it("counts new and stale applications separately", async () => {
    const opportunity = await base.opportunity.create({
      data: {
        type: "CREW_JOB",
        title: `Mechanic ${run}`,
        description: "Weekends.",
        postedByTeamId: teamId,
      },
    });
    const applicants = await Promise.all(
      ["fresh", "old", "reviewing"].map(async (label) => {
        const user = await base.user.create({
          data: {
            email: `${label}_${run}@example.test`,
            authProviderId: `clerk_${label}_${run}`,
          },
        });
        userIds.push(user.id);
        return user;
      }),
    );

    const longAgo = new Date(
      Date.now() - (STALE_AFTER_DAYS + 5) * 86_400_000,
    );
    await base.application.create({
      data: { opportunityId: opportunity.id, applicantId: applicants[0]!.id },
    });
    await base.application.create({
      data: {
        opportunityId: opportunity.id,
        applicantId: applicants[1]!.id,
        createdAt: longAgo,
      },
    });
    await base.application.create({
      data: {
        opportunityId: opportunity.id,
        applicantId: applicants[2]!.id,
        status: ApplicationStatus.REVIEWING,
        createdAt: longAgo,
      },
    });

    const row = (
      await teamAttention(base, [
        { id: teamId, name: "attention", slug: teamSlug },
      ])
    ).get(teamId)!;

    // Two unopened; two waiting over a week, one of which is also unopened.
    expect(row.newApplications).toBe(2);
    expect(row.staleApplications).toBe(2);
  });

  it("counts interviews the team has to act on, not ones waiting on the applicant", async () => {
    const application = await base.application.findFirstOrThrow({
      where: { opportunity: { postedByTeamId: teamId } },
    });

    // Waiting on them — not the team's move.
    await base.interview.create({
      data: {
        applicationId: application.id,
        status: InterviewStatus.PROPOSED,
        slots: { create: { startsAt: new Date(Date.now() + 86_400_000) } },
      },
    });
    // They could not make any: the team owes new times.
    await base.interview.create({
      data: {
        applicationId: application.id,
        status: InterviewStatus.DECLINED,
      },
    });
    // Booked and already been: somebody has to say how it went.
    await base.interview.create({
      data: {
        applicationId: application.id,
        status: InterviewStatus.CONFIRMED,
        scheduledAt: new Date(Date.now() - 86_400_000),
      },
    });
    // Booked and still ahead: nothing to do yet.
    await base.interview.create({
      data: {
        applicationId: application.id,
        status: InterviewStatus.CONFIRMED,
        scheduledAt: new Date(Date.now() + 172_800_000),
      },
    });

    const row = (
      await teamAttention(base, [
        { id: teamId, name: "attention", slug: teamSlug },
      ])
    ).get(teamId)!;
    expect(row.interviewsToArrange).toBe(2);
  });

  it("counts a service overdue on hours, and not one still ahead", async () => {
    const car = await base.car.create({
      data: { teamId, name: `Car ${run}`, runningHours: 40 },
    });
    await base.carService.createMany({
      data: [
        {
          carId: car.id,
          component: "Gearbox",
          status: ServiceStatus.PLANNED,
          nextDueHours: 30,
        },
        {
          carId: car.id,
          component: "Belts",
          status: ServiceStatus.PLANNED,
          nextDueHours: 90,
        },
        {
          // Deferred is a decision to stop being reminded.
          carId: car.id,
          component: "Seat",
          status: ServiceStatus.DEFERRED,
          nextDueHours: 1,
        },
      ],
    });

    const row = (
      await teamAttention(base, [
        { id: teamId, name: "attention", slug: teamSlug },
      ])
    ).get(teamId)!;
    expect(row.overdueServices).toBe(1);
  });

  it("counts a draft run to approve and a part-paid run once, not per line", async () => {
    await base.payRun.create({
      data: {
        teamId,
        label: `Draft ${run}`,
        periodStart: new Date("2026-01-01"),
        periodEnd: new Date("2026-01-31"),
        status: PayRunStatus.DRAFT,
      },
    });
    const approved = await base.payRun.create({
      data: {
        teamId,
        label: `Approved ${run}`,
        periodStart: new Date("2026-02-01"),
        periodEnd: new Date("2026-02-28"),
        status: PayRunStatus.APPROVED,
      },
    });
    // Three unpaid lines on one run is one thing to do.
    await base.payrollLine.createMany({
      data: [1, 2, 3].map((index) => ({
        payRunId: approved.id,
        userId: managerId,
        description: `Line ${index}`,
        basis: PayBasis.PER_EVENT,
        quantity: 1,
        rateMinor: 10_000,
        amountMinor: 10_000,
      })),
    });

    const row = (
      await teamAttention(base, [
        { id: teamId, name: "attention", slug: teamSlug },
      ])
    ).get(teamId)!;
    expect(row.payRunsToApprove).toBe(1);
    expect(row.payRunsToPay).toBe(1);
  });

  it("counts stock at or below its reorder level, ignoring untracked lines", async () => {
    await base.inventoryItem.createMany({
      data: [
        { teamId, name: "Pads", category: PartCategory.BRAKES, quantity: 0, minQuantity: 4 },
        { teamId, name: "Belts", quantity: 2, minQuantity: 2 },
        { teamId, name: "Bolts", quantity: 50, minQuantity: 10 },
        // No threshold: nobody has said what enough looks like, so it is not
        // a shopping-list entry.
        { teamId, name: "Rags", quantity: 0 },
      ],
    });

    const row = (
      await teamAttention(base, [
        { id: teamId, name: "attention", slug: teamSlug },
      ])
    ).get(teamId)!;
    expect(row.lowStock).toBe(2);
  });

  // -- Access --------------------------------------------------------------

  it("gives a manager the counts on the console", async () => {
    const caller = createCaller({
      db: base,
      clerkUserId: managerAuthId,
      headers: new Headers(),
    });
    const dashboard = await caller.team.dashboard({ teamId });
    expect(dashboard.attention).not.toBeNull();
    expect(dashboard.attention!.newApplications).toBeGreaterThan(0);
  });

  it("tells a driver nothing rather than telling them zero", async () => {
    // "Nothing needs attention" and "you are not allowed to know" are
    // different answers; returning the second as the first would quietly say
    // the team has no outstanding pay runs.
    const caller = createCaller({
      db: base,
      clerkUserId: driverAuthId,
      headers: new Headers(),
    });
    const dashboard = await caller.team.dashboard({ teamId });
    expect(dashboard.attention).toBeNull();
  });

  it("puts a managed team on the home dashboard and leaves a driver's off", async () => {
    const asManager = createCaller({
      db: base,
      clerkUserId: managerAuthId,
      headers: new Headers(),
    });
    const asDriver = createCaller({
      db: base,
      clerkUserId: driverAuthId,
      headers: new Headers(),
    });

    const managerHome = await asManager.dashboard.home();
    expect(managerHome.attention.map((row) => row.teamId)).toContain(teamId);

    const driverHome = await asDriver.dashboard.home();
    expect(driverHome.attention).toEqual([]);
  });

  // -- Query shape ---------------------------------------------------------

  it("costs the same for five teams as for one", async () => {
    // The home dashboard asks this for every team somebody manages.
    const meter = counting();
    const manager = await base.user.findFirstOrThrow({
      where: { authProviderId: managerAuthId },
    });

    const one = [{ id: teamId, name: "attention", slug: teamSlug }];
    await teamAttention(meter.db, one);
    meter.reset();
    await teamAttention(meter.db, one);
    const small = meter.count();

    const more = [...one];
    for (let index = 0; index < 4; index += 1) {
      const team = await makeTeam(`attention-extra-${index}`);
      await base.teamMembership.create({
        data: { teamId: team.id, userId: manager.id, role: TeamRole.OWNER },
      });
      more.push({ id: team.id, name: team.name, slug: team.slug });
    }

    meter.reset();
    await teamAttention(meter.db, more);
    const large = meter.count();

    expect(small).toBeGreaterThan(0);
    expect(large).toBe(small);
    // Deliberately not disconnected: `$extends` shares the underlying engine
    // with `base`, so closing the wrapper closes the client every other test
    // in this file is still using.
  });
});
