import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PrismaClient,
  ResultStatus,
  SeriesDiscipline,
  SponsorshipStatus,
  TeamRole,
} from "@prisma/client";
import { createCaller } from "@/server/trpc/root";

/**
 * Team management end-to-end: roster, entries, season record, sponsorship and
 * team chat. Opt in with RUN_DB_TESTS=1.
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

const anon = () => callerFor(null);

describe.skipIf(!ENABLED)("team management (integration)", () => {
  const run = Date.now();
  let owner: Awaited<ReturnType<typeof makeUser>>;
  let manager: Awaited<ReturnType<typeof makeUser>>;
  let driver: Awaited<ReturnType<typeof makeUser>>;
  let sponsor: Awaited<ReturnType<typeof makeUser>>;
  let outsider: Awaited<ReturnType<typeof makeUser>>;
  let organizer: Awaited<ReturnType<typeof makeUser>>;
  let teamId: string;
  let teamSlug: string;
  let seriesId: string;
  let eventId: string;
  let registrationId: string;

  beforeAll(async () => {
    owner = await makeUser(`tmowner_${run}`);
    manager = await makeUser(`tmmgr_${run}`);
    driver = await makeUser(`tmdrv_${run}`);
    sponsor = await makeUser(`tmspon_${run}`);
    outsider = await makeUser(`tmout_${run}`);
    organizer = await makeUser(`tmorg_${run}`);

    const team = await owner.caller.team.create({
      name: `Apex Racing ${run}`,
      description: "GT3 endurance outfit.",
    });
    teamId = team.id;
    teamSlug = team.slug;

    for (const [person, role] of [
      [manager, TeamRole.MANAGER],
      [driver, TeamRole.DRIVER],
    ] as const) {
      await person.caller.team.join({ teamId });
      await owner.caller.team.setMemberRole({
        teamId,
        userId: person.user.id,
        role,
      });
    }

    // A completed round so the team has a classified result to report.
    const series = await organizer.caller.series.create({
      name: `Team Cup ${run}`,
      discipline: SeriesDiscipline.SIM,
      platform: "iRacing",
    });
    seriesId = series.id;

    const event = await organizer.caller.event.create({
      seriesId,
      name: "Team Round 1",
      date: new Date(Date.now() - 864e5),
      platform: "iRacing",
    });
    eventId = event.id;
    await organizer.caller.event.setStatus({ eventId, status: "PUBLISHED" });

    const registration = await owner.caller.event.register({
      eventId,
      teamId,
      carNumber: "24",
      carClass: "GT3",
    });
    registrationId = registration.id;
    await organizer.caller.event.setRegistrationStatus({
      registrationId,
      status: "CONFIRMED",
    });
    await organizer.caller.event.recordResult({
      registrationId,
      finishPosition: 1,
      status: ResultStatus.FINISHED,
      fastestLap: true,
    });
    await organizer.caller.event.setStatus({ eventId, status: "COMPLETED" });
  });

  afterAll(async () => {
    if (!ENABLED) return;
    await db.series.deleteMany({ where: { id: seriesId } });
    await db.team.deleteMany({ where: { id: teamId } });
    await db.user.deleteMany({
      where: {
        authProviderId: {
          in: [owner, manager, driver, sponsor, outsider, organizer].map(
            (u) => u.user.authProviderId!,
          ),
        },
      },
    });
    await db.$disconnect();
  });

  // -------------------------------------------------------------------------
  // Roster
  // -------------------------------------------------------------------------

  it("opens the console to members and closes it to outsiders", async () => {
    const view = await driver.caller.team.dashboard({ teamId });
    expect(view.myRole).toBe(TeamRole.DRIVER);
    expect(view.roster).toHaveLength(3);

    await expect(
      outsider.caller.team.dashboard({ teamId }),
    ).rejects.toThrow(/current team members/i);
  });

  it("lets managers change roles but not drivers", async () => {
    await manager.caller.team.setMemberRole({
      teamId,
      userId: driver.user.id,
      role: TeamRole.ENGINEER,
    });
    let view = await owner.caller.team.dashboard({ teamId });
    expect(
      view.roster.find((m) => m.userId === driver.user.id)?.role,
    ).toBe(TeamRole.ENGINEER);

    await expect(
      driver.caller.team.setMemberRole({
        teamId,
        userId: manager.user.id,
        role: TeamRole.MEMBER,
      }),
    ).rejects.toThrow(/owner or manager/i);

    // Put them back for later assertions.
    await owner.caller.team.setMemberRole({
      teamId,
      userId: driver.user.id,
      role: TeamRole.DRIVER,
    });
    view = await owner.caller.team.dashboard({ teamId });
    expect(view.roster.find((m) => m.userId === driver.user.id)?.role).toBe(
      TeamRole.DRIVER,
    );
  });

  it("refuses to leave a team with no owner", async () => {
    await expect(
      owner.caller.team.removeMember({ teamId, userId: owner.user.id }),
    ).rejects.toThrow(/at least one owner/i);
    await expect(
      owner.caller.team.setMemberRole({
        teamId,
        userId: owner.user.id,
        role: TeamRole.MANAGER,
      }),
    ).rejects.toThrow(/another owner/i);
  });

  it("closes out a membership rather than deleting it", async () => {
    const extra = await makeUser(`tmtemp_${run}`);
    await extra.caller.team.join({ teamId });
    await manager.caller.team.removeMember({
      teamId,
      userId: extra.user.id,
    });

    const view = await owner.caller.team.dashboard({ teamId });
    const row = view.roster.find((m) => m.userId === extra.user.id);
    // Still on the record, but no longer current — past line-ups survive.
    expect(row).toBeDefined();
    expect(row!.endDate).not.toBeNull();

    // A removed member loses console access.
    await expect(
      extra.caller.team.dashboard({ teamId }),
    ).rejects.toThrow(/current team members/i);

    await db.user.delete({ where: { id: extra.user.id } });
  });

  // -------------------------------------------------------------------------
  // Schedule, results and standings
  // -------------------------------------------------------------------------

  it("shows the team's entries on the console", async () => {
    const view = await owner.caller.team.dashboard({ teamId });
    expect(view.registrations).toHaveLength(1);
    expect(view.registrations[0].carNumber).toBe("24");
    expect(view.registrations[0].event.name).toBe("Team Round 1");
  });

  it("reports the season record and championship position publicly", async () => {
    const season = await anon().team.season({ teamId });

    expect(season.results).toHaveLength(1);
    expect(season.results[0].finishPosition).toBe(1);
    expect(season.results[0].fastestLap).toBe(true);

    expect(season.summaries).toHaveLength(1);
    const summary = season.summaries[0];
    expect(summary.seriesName).toBe(`Team Cup ${run}`);
    expect(summary.position).toBe(1);
    expect(summary.wins).toBe(1);
    expect(summary.podiums).toBe(1);
    expect(summary.bestFinish).toBe(1);
    // Default FIA scheme: a win is 25.
    expect(summary.points).toBe(25);
  });

  it("reflects a points penalty in the team's standings position", async () => {
    const penalty = await organizer.caller.penalty.issue({
      registrationId,
      type: "POINTS_DEDUCTION",
      summary: "Technical infringement",
      pointsDeducted: 10,
    });

    let season = await anon().team.season({ teamId });
    expect(season.summaries[0].points).toBe(15);
    expect(season.summaries[0].pointsDeducted).toBe(10);
    expect(season.results[0].activePenalties).toBe(1);

    // Overturning it restores the points without recomputation elsewhere.
    const appeal = await owner.caller.penalty.fileAppeal({
      penaltyId: penalty.id,
      statement:
        "The part was homologated for this class; paperwork is attached.",
    });
    await organizer.caller.penalty.decideAppeal({
      appealId: appeal.id,
      outcome: "UPHELD",
      decision: "Homologation confirmed, penalty overturned.",
    });

    season = await anon().team.season({ teamId });
    expect(season.summaries[0].points).toBe(25);
    expect(season.summaries[0].pointsDeducted).toBe(0);
    expect(season.results[0].activePenalties).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Sponsorship
  // -------------------------------------------------------------------------

  it("keeps commercial terms to the team", async () => {
    await expect(
      outsider.caller.sponsorship.forTeam({ teamId }),
    ).rejects.toThrow(/visible to the team only/i);
    // Any current member may read them, not only managers.
    const view = await driver.caller.sponsorship.forTeam({ teamId });
    expect(view.deals).toEqual([]);
  });

  it("takes an offer from a sponsor and notifies the managers", async () => {
    const before = await db.notification.count({
      where: { userId: owner.user.id },
    });

    const offer = await sponsor.caller.sponsorship.offer({
      teamId,
      sponsorName: "Apex Brake Systems",
      valueMinor: 2_500_000,
      currency: "USD",
      tier: "Primary",
      notes: "Full livery plus socials.",
    });
    expect(offer.status).toBe(SponsorshipStatus.OFFERED);
    expect(offer.sponsorUserId).toBe(sponsor.user.id);

    expect(
      await db.notification.count({ where: { userId: owner.user.id } }),
    ).toBe(before + 1);

    const view = await owner.caller.sponsorship.forTeam({ teamId });
    expect(view.summary.openOfferCount).toBe(1);
    expect(view.summary.activeCount).toBe(0);

    // The sponsor can track their own pitch.
    const mine = await sponsor.caller.sponsorship.mine();
    expect(mine.map((deal) => deal.id)).toContain(offer.id);
  });

  it("lets a manager accept an offer and tells the sponsor", async () => {
    const view = await owner.caller.sponsorship.forTeam({ teamId });
    const offer = view.deals.find(
      (deal) => deal.status === SponsorshipStatus.OFFERED,
    )!;

    const before = await db.notification.count({
      where: { userId: sponsor.user.id },
    });
    const accepted = await manager.caller.sponsorship.setStatus({
      sponsorshipId: offer.id,
      status: SponsorshipStatus.ACTIVE,
    });
    expect(accepted.status).toBe(SponsorshipStatus.ACTIVE);
    // Accepting with no explicit start date starts it now.
    expect(accepted.startDate).not.toBeNull();
    expect(
      await db.notification.count({ where: { userId: sponsor.user.id } }),
    ).toBe(before + 1);

    const after = await owner.caller.sponsorship.forTeam({ teamId });
    expect(after.summary.activeCount).toBe(1);
    expect(after.summary.activeValueByCurrency).toEqual({ USD: 2_500_000 });
  });

  it("will not walk a deal backwards or reopen a closed one", async () => {
    const view = await owner.caller.sponsorship.forTeam({ teamId });
    const active = view.deals.find(
      (deal) => deal.status === SponsorshipStatus.ACTIVE,
    )!;

    await expect(
      owner.caller.sponsorship.setStatus({
        sponsorshipId: active.id,
        status: SponsorshipStatus.NEGOTIATING,
      }),
    ).rejects.toThrow(/cannot move a deal/i);

    await owner.caller.sponsorship.setStatus({
      sponsorshipId: active.id,
      status: SponsorshipStatus.EXPIRED,
    });
    await expect(
      owner.caller.sponsorship.setStatus({
        sponsorshipId: active.id,
        status: SponsorshipStatus.ACTIVE,
      }),
    ).rejects.toThrow(/cannot move a deal/i);
  });

  it("lets a manager record an offline deal but blocks a driver", async () => {
    await expect(
      driver.caller.sponsorship.create({
        teamId,
        sponsorName: "Unauthorized Co",
      }),
    ).rejects.toThrow(/owner or manager/i);

    const deal = await manager.caller.sponsorship.create({
      teamId,
      sponsorName: "Local Garage",
      valueMinor: 150_000,
      currency: "EUR",
      season: "2026",
    });
    expect(deal.status).toBe(SponsorshipStatus.ACTIVE);
    expect(deal.sponsorUserId).toBeNull();

    const view = await owner.caller.sponsorship.forTeam({ teamId });
    expect(view.summary.activeValueByCurrency).toEqual({ EUR: 150_000 });
  });

  it("refuses a deal that ends before it starts", async () => {
    await expect(
      manager.caller.sponsorship.create({
        teamId,
        sponsorName: "Backwards Ltd",
        startDate: new Date("2026-06-01"),
        endDate: new Date("2026-05-01"),
      }),
    ).rejects.toThrow(/cannot end before it starts/i);
  });

  // -------------------------------------------------------------------------
  // Team chat
  // -------------------------------------------------------------------------

  it("gives the team its own room, closed to outsiders", async () => {
    await expect(
      outsider.caller.chat.forRoom({ scope: { teamId } }),
    ).rejects.toThrow(/current team members/i);

    await driver.caller.chat.send({
      scope: { teamId },
      body: "Setup sheet for Sunday?",
    });
    const view = await manager.caller.chat.forRoom({ scope: { teamId } });
    expect(view.messages.map((m) => m.body)).toContain(
      "Setup sheet for Sunday?",
    );
    expect(view.canModerate).toBe(true);

    // A driver is in the room but does not moderate it.
    const driverView = await driver.caller.chat.forRoom({ scope: { teamId } });
    expect(driverView.canModerate).toBe(false);
  });

  it("keeps team chat separate from event paddock chat", async () => {
    await owner.caller.chat.send({
      scope: { eventId },
      body: "Paddock-only message",
    });
    const teamRoom = await owner.caller.chat.forRoom({ scope: { teamId } });
    expect(teamRoom.messages.map((m) => m.body)).not.toContain(
      "Paddock-only message",
    );
  });

  it("refuses a message addressed to both rooms or neither", async () => {
    await expect(
      owner.caller.chat.send({ scope: { teamId, eventId }, body: "Both" }),
    ).rejects.toThrow();
    await expect(
      owner.caller.chat.send({ scope: {}, body: "Neither" }),
    ).rejects.toThrow();
  });

  it("lets managers moderate team chat and authors delete their own", async () => {
    const mine = await driver.caller.chat.send({
      scope: { teamId },
      body: "My own message",
    });
    await driver.caller.chat.remove({ messageId: mine.id });

    const theirs = await driver.caller.chat.send({
      scope: { teamId },
      body: "Moderate me",
    });
    await expect(
      outsider.caller.chat.remove({ messageId: theirs.id }),
    ).rejects.toThrow(/current team members/i);
    await owner.caller.chat.remove({ messageId: theirs.id });

    const view = await owner.caller.chat.forRoom({ scope: { teamId } });
    const ids = view.messages.map((m) => m.id);
    expect(ids).not.toContain(mine.id);
    expect(ids).not.toContain(theirs.id);
  });

  // -------------------------------------------------------------------------
  // Public page data
  // -------------------------------------------------------------------------

  it("serves the public team page without a session", async () => {
    const team = await anon().team.bySlug({ slug: teamSlug });
    expect(team.name).toBe(`Apex Racing ${run}`);
    // Role tags come through for the line-up cards.
    expect(team.roster[0].user.profile).toHaveProperty("simRoles");
  });
});
