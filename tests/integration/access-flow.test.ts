import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AccessRequestKind,
  AccessRequestStatus,
  PlatformRole,
  PrismaClient,
  SeriesDiscipline,
  SponsorshipStatus,
  TeamRole,
} from "@prisma/client";
import { createCaller } from "@/server/trpc/root";

/**
 * The gate on publishing, end to end.
 *
 * Two halves, and both matter. The obvious half is that an unapproved account
 * cannot stand up a team, an organization, a championship or a sponsor pitch.
 * The half that is easy to get wrong is what an approval is *worth*: one
 * creation, not a standing licence. A spam account that gets one application
 * past a tired reviewer should get one team out of it, not thirty.
 *
 * Opt in with RUN_DB_TESTS=1.
 */
const ENABLED = process.env.RUN_DB_TESTS === "1";
const db = ENABLED ? new PrismaClient() : (null as unknown as PrismaClient);

function callerFor(clerkUserId: string | null) {
  return createCaller({ db, clerkUserId, headers: new Headers() });
}

async function makeUser(suffix: string, role: PlatformRole = PlatformRole.MEMBER) {
  const user = await db.user.create({
    data: {
      email: `${suffix}@example.test`,
      authProviderId: `clerk_${suffix}`,
      platformRole: role,
      profile: { create: { displayName: suffix } },
    },
  });
  return { user, caller: callerFor(user.authProviderId) };
}

describe.skipIf(!ENABLED)("access requests (integration)", () => {
  const run = Date.now();
  let applicant: Awaited<ReturnType<typeof makeUser>>;
  let other: Awaited<ReturnType<typeof makeUser>>;
  let reviewer: Awaited<ReturnType<typeof makeUser>>;
  const created: string[] = [];

  // The environment list is the bootstrap route in, and leaving it set would
  // make every "unapproved" assertion below pass for the wrong reason.
  const savedEnv = process.env.PLATFORM_ADMIN_EMAILS;

  beforeAll(async () => {
    process.env.PLATFORM_ADMIN_EMAILS = "";
    applicant = await makeUser(`acc_app_${run}`);
    other = await makeUser(`acc_oth_${run}`);
    reviewer = await makeUser(`acc_rev_${run}`, PlatformRole.ADMIN);
    created.push(
      applicant.user.authProviderId,
      other.user.authProviderId,
      reviewer.user.authProviderId,
    );
  });

  afterAll(async () => {
    if (!ENABLED) return;
    process.env.PLATFORM_ADMIN_EMAILS = savedEnv;
    const users = await db.user.findMany({
      where: { authProviderId: { in: created } },
      select: { id: true },
    });
    const ids = users.map((u) => u.id);
    await db.sponsorship.deleteMany({
      where: { OR: [{ createdById: { in: ids } }, { sponsorUserId: { in: ids } }] },
    });
    await db.team.deleteMany({ where: { roster: { some: { userId: { in: ids } } } } });
    await db.series.deleteMany({
      where: { organizers: { some: { userId: { in: ids } } } },
    });
    await db.organization.deleteMany({
      where: { members: { some: { userId: { in: ids } } } },
    });
    await db.accessRequest.deleteMany({ where: { requestedById: { in: ids } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
    await db.$disconnect();
  });

  it("refuses to create a team, organization or series without approval", async () => {
    await expect(
      applicant.caller.team.create({ name: `Unapproved Team ${run}` }),
    ).rejects.toThrow(/approval/i);
    await expect(
      applicant.caller.organization.create({ name: `Unapproved Club ${run}` }),
    ).rejects.toThrow(/approval/i);
    await expect(
      applicant.caller.series.create({
        name: `Unapproved Cup ${run}`,
        discipline: SeriesDiscipline.REAL_WORLD,
        platform: "Circuit",
      }),
    ).rejects.toThrow(/approval/i);

    // Nothing half-created behind the refusal.
    expect(await db.team.count({ where: { name: `Unapproved Team ${run}` } })).toBe(0);
  });

  it("points at the form rather than saying no", async () => {
    // Somebody hitting this is usually a legitimate person who did not know
    // there was a queue; a bare FORBIDDEN reads as a bug.
    await expect(
      applicant.caller.team.create({ name: `Signposted ${run}` }),
    ).rejects.toThrow(/\/apply/);
  });

  it("lets anyone apply, and blocks a second open application for the same thing", async () => {
    const request = await applicant.caller.access.submit({
      kind: AccessRequestKind.TEAM,
      proposedName: `Apex Racing ${run}`,
      summary: "Two of us, one E36, we run club enduros in the south east.",
      websiteUrl: "https://example.test/apex",
    });
    expect(request.status).toBe(AccessRequestStatus.PENDING);

    await expect(
      applicant.caller.access.submit({
        kind: AccessRequestKind.TEAM,
        proposedName: `Apex Racing Again ${run}`,
        summary: "The same team, applied for twice, which is queue noise.",
      }),
    ).rejects.toThrow(/waiting on review/i);
  });

  it("keeps the queue away from ordinary members", async () => {
    await expect(other.caller.access.queue({})).rejects.toThrow(/moderator/i);
    await expect(
      other.caller.access.staff({}),
    ).rejects.toThrow(/moderator/i);
  });

  it("will not let one applicant withdraw another's application", async () => {
    const mine = await applicant.caller.access.mine();
    const request = mine.requests[0]!;
    await expect(
      other.caller.access.withdraw({ requestId: request.id }),
    ).rejects.toThrow();
  });

  it("insists a decline says why", async () => {
    const [pending] = (await reviewer.caller.access.queue({
      status: AccessRequestStatus.PENDING,
    })).requests.filter((r) => r.requestedById === applicant.user.id);

    await expect(
      reviewer.caller.access.decide({
        requestId: pending!.id,
        approve: false,
        note: "   ",
      }),
    ).rejects.toThrow(/why/i);
  });

  it("approves, and the approval buys exactly one team", async () => {
    const queue = await reviewer.caller.access.queue({
      status: AccessRequestStatus.PENDING,
    });
    const request = queue.requests.find(
      (r) => r.requestedById === applicant.user.id,
    )!;

    await reviewer.caller.access.decide({
      requestId: request.id,
      approve: true,
      note: "Looks like a real team.",
    });

    const team = await applicant.caller.team.create({
      name: `Apex Racing ${run}`,
    });
    expect(team.id).toBeTruthy();

    // The applicant is the owner, so the approval bought them a working team
    // and not just a row.
    const membership = await db.teamMembership.findUniqueOrThrow({
      where: { teamId_userId: { teamId: team.id, userId: applicant.user.id } },
    });
    expect(membership.role).toBe(TeamRole.OWNER);

    // The approval is spent — a second team is a second application.
    await expect(
      applicant.caller.team.create({ name: `Apex Racing Two ${run}` }),
    ).rejects.toThrow(/approval/i);

    const spent = await db.accessRequest.findUniqueOrThrow({
      where: { id: request.id },
    });
    expect(spent.fulfilledEntityId).toBe(team.id);
    expect(spent.fulfilledAt).not.toBeNull();
  });

  it("does not spend the approval when the creation fails", async () => {
    // A name clash after the approval check would otherwise burn somebody's
    // application on a team that does not exist.
    const request = await applicant.caller.access.submit({
      kind: AccessRequestKind.TEAM,
      proposedName: `Second Team ${run}`,
      summary: "A second entry, which is a second application by design.",
    });
    await reviewer.caller.access.decide({ requestId: request.id, approve: true });

    await expect(
      applicant.caller.team.create({ name: `Apex Racing ${run}` }),
    ).rejects.toThrow(/already exists/i);

    const still = await db.accessRequest.findUniqueOrThrow({
      where: { id: request.id },
    });
    expect(still.fulfilledEntityId).toBeNull();

    // And it is still good for the team they meant to create.
    const team = await applicant.caller.team.create({
      name: `Second Team ${run}`,
    });
    expect(team.name).toBe(`Second Team ${run}`);
  });

  it("does not let an approval for one kind create another", async () => {
    const request = await applicant.caller.access.submit({
      kind: AccessRequestKind.ORGANIZATION,
      proposedName: `Apex Club ${run}`,
      summary: "A club that would run a handful of regional rounds a year.",
    });
    await reviewer.caller.access.decide({ requestId: request.id, approve: true });

    await expect(
      applicant.caller.series.create({
        name: `Wrong Kind Cup ${run}`,
        discipline: SeriesDiscipline.REAL_WORLD,
        platform: "Circuit",
      }),
    ).rejects.toThrow(/approval/i);

    const organization = await applicant.caller.organization.create({
      name: `Apex Club ${run}`,
    });
    expect(organization.id).toBeTruthy();
    // Starter roles came with it, inside the same transaction as the spend.
    expect(organization.staffRoles.length).toBeGreaterThan(0);
  });

  it("lets platform staff create without applying to themselves", async () => {
    const team = await reviewer.caller.team.create({
      name: `Staff Team ${run}`,
    });
    expect(team.id).toBeTruthy();
    expect(
      await db.accessRequest.count({ where: { requestedById: reviewer.user.id } }),
    ).toBe(0);
  });

  it("withdraws a pending application and refuses to decide it afterwards", async () => {
    const request = await other.caller.access.submit({
      kind: AccessRequestKind.SERIES,
      proposedName: `Withdrawn Cup ${run}`,
      summary: "Changed our minds about running a championship this year.",
    });
    await other.caller.access.withdraw({ requestId: request.id });

    await expect(
      reviewer.caller.access.decide({ requestId: request.id, approve: true }),
    ).rejects.toThrow(/already been decided/i);

    // And a withdrawn application creates nothing.
    await expect(
      other.caller.series.create({
        name: `Withdrawn Cup ${run}`,
        discipline: SeriesDiscipline.REAL_WORLD,
        platform: "Circuit",
      }),
    ).rejects.toThrow(/approval/i);
  });

  it("gates sponsor pitching, and opens it once for every team", async () => {
    const team = await db.team.findFirstOrThrow({
      where: { name: `Apex Racing ${run}` },
    });
    const second = await db.team.findFirstOrThrow({
      where: { name: `Second Team ${run}` },
    });

    await expect(
      other.caller.sponsorship.offer({
        teamId: team.id,
        sponsorName: `Spam Co ${run}`,
      }),
    ).rejects.toThrow(/approval/i);
    expect((await other.caller.sponsor.access()).approved).toBe(false);
    await expect(other.caller.sponsor.dashboard()).rejects.toThrow(/approval/i);

    const request = await other.caller.access.submit({
      kind: AccessRequestKind.SPONSOR,
      proposedName: `Real Brake Co ${run}`,
      summary: "We make brake pads and back two club teams a season.",
    });
    await reviewer.caller.access.decide({ requestId: request.id, approve: true });

    expect((await other.caller.sponsor.access()).approved).toBe(true);

    // Unlike the creating kinds, a sponsor approval is never spent — the whole
    // point is one application covering every team.
    await other.caller.sponsorship.offer({
      teamId: team.id,
      sponsorName: `Real Brake Co ${run}`,
      valueMinor: 250_000,
    });
    await other.caller.sponsorship.offer({
      teamId: second.id,
      sponsorName: `Real Brake Co ${run}`,
      valueMinor: 100_000,
      currency: "GBP",
    });

    const still = await db.accessRequest.findUniqueOrThrow({
      where: { id: request.id },
    });
    expect(still.fulfilledEntityId).toBeNull();
  });

  it("shows the sponsor their whole book, not one team's corner of it", async () => {
    const dashboard = await other.caller.sponsor.dashboard();
    expect(dashboard.deals).toHaveLength(2);
    expect(dashboard.totals.teamsApproached).toBe(2);
    // Offered, not accepted — money on the table is not committed spend.
    expect(dashboard.totals.liveSpendByCurrency).toEqual({});
    expect(dashboard.totals.pendingValueByCurrency).toEqual({
      USD: 250_000,
      GBP: 100_000,
    });
  });

  it("lets a sponsor pull an offer nobody has answered, and not one in play", async () => {
    const dashboard = await other.caller.sponsor.dashboard();
    const [first, second] = dashboard.deals;

    await other.caller.sponsor.withdrawOffer({
      sponsorshipId: first!.id,
      reason: "Budget went elsewhere.",
    });
    const pulled = await db.sponsorship.findUniqueOrThrow({
      where: { id: first!.id },
    });
    expect(pulled.status).toBe(SponsorshipStatus.DECLINED);
    expect(pulled.notes).toContain("Budget went elsewhere");

    // Once the team has opened talks it is a conversation, and one side
    // deleting it loses the other side's context.
    await db.sponsorship.update({
      where: { id: second!.id },
      data: { status: SponsorshipStatus.NEGOTIATING },
    });
    await expect(
      other.caller.sponsor.withdrawOffer({ sponsorshipId: second!.id }),
    ).rejects.toThrow(/already picked this up/i);
  });

  it("will not let one sponsor withdraw another's offer", async () => {
    const dashboard = await other.caller.sponsor.dashboard();
    await expect(
      reviewer.caller.sponsor.withdrawOffer({
        sponsorshipId: dashboard.deals[0]!.id,
      }),
    ).rejects.toThrow(/not yours/i);
  });

  it("finds teams to approach and marks the ones already in the book", async () => {
    const found = await other.caller.sponsor.discoverTeams({
      query: `Apex Racing ${run}`,
    });
    const team = found.teams.find((t) => t.name === `Apex Racing ${run}`);
    expect(team).toBeTruthy();
    // Marked, not hidden: renewing with last season's team is the common case.
    expect(team!.existingStatuses.length).toBeGreaterThan(0);
  });

  it("will not let the last admin lock the queue", async () => {
    // Demoting yourself with nobody left and no PLATFORM_ADMIN_EMAILS leaves a
    // queue nobody can open, and applications that never get answered.
    const otherAdmins = await db.user.count({
      where: { platformRole: PlatformRole.ADMIN, id: { not: reviewer.user.id } },
    });
    if (otherAdmins > 0) return;
    await expect(
      reviewer.caller.access.setPlatformRole({
        userId: reviewer.user.id,
        role: PlatformRole.MEMBER,
      }),
    ).rejects.toThrow(/only platform admin/i);
  });

  it("finds a member by their exact address and not by a fragment", async () => {
    const exact = await reviewer.caller.access.staff({
      query: applicant.user.email,
    });
    expect(exact.matches.map((m) => m.id)).toContain(applicant.user.id);

    // A substring search here would be a way to enumerate the membership.
    const fragment = await reviewer.caller.access.staff({ query: "example" });
    expect(fragment.matches).toEqual([]);
  });
});
