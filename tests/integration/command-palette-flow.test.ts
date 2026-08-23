import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  EventStatus,
  PlatformRole,
  PrismaClient,
  SeriesDiscipline,
  SeriesRole,
  SessionStatus,
  SessionType,
  TeamRole,
} from "@prisma/client";
import { createCaller } from "@/server/trpc/root";
import { buildCommands } from "@/lib/command-set";
import { rankCommands } from "@/lib/command-palette";

/**
 * What the command palette is allowed to know about you.
 *
 * The palette is a list of places, and a list of places is a disclosure: a
 * driver must not be handed their team's console, and somebody with no series
 * role must not be handed a race weekend's race control. The matching is
 * covered by the unit tests; what needs a database is who gets offered what.
 *
 * Opt in with RUN_DB_TESTS=1.
 */
const ENABLED = process.env.RUN_DB_TESTS === "1";
const db = ENABLED ? new PrismaClient() : (null as unknown as PrismaClient);

function callerFor(clerkUserId: string | null) {
  return createCaller({ db, clerkUserId, headers: new Headers() });
}

async function makeUser(suffix: string, platformRole: PlatformRole = PlatformRole.MEMBER) {
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

describe.skipIf(!ENABLED)("command palette contexts (integration)", () => {
  const run = Date.now();
  let manager: Awaited<ReturnType<typeof makeUser>>;
  let driver: Awaited<ReturnType<typeof makeUser>>;
  let official: Awaited<ReturnType<typeof makeUser>>;
  let staff: Awaited<ReturnType<typeof makeUser>>;
  let eventId: string;
  let liveEventId: string;

  beforeAll(async () => {
    if (!ENABLED) return;
    manager = await makeUser(`palette-mgr-${run}`);
    driver = await makeUser(`palette-drv-${run}`);
    official = await makeUser(`palette-off-${run}`);
    staff = await makeUser(`palette-staff-${run}`, PlatformRole.ADMIN);

    await db.team.create({
      data: {
        name: `Palette Racing ${run}`,
        slug: `palette-racing-${run}`,
        roster: {
          create: [
            { userId: manager.user.id, role: TeamRole.MANAGER },
            { userId: driver.user.id, role: TeamRole.DRIVER },
          ],
        },
      },
    });

    const series = await db.series.create({
      data: {
        name: `Palette Cup ${run}`,
        slug: `palette-cup-${run}`,
        discipline: SeriesDiscipline.REAL_WORLD,
        platform: "Circuit",
        organizers: { create: { userId: official.user.id, role: SeriesRole.RACE_CONTROL } },
      },
    });

    const event = await db.raceEvent.create({
      data: {
        name: `Palette Round 1 ${run}`,
        seriesLabel: series.name,
        seriesId: series.id,
        platform: "Real world",
        date: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        status: EventStatus.PUBLISHED,
      },
    });
    eventId = event.id;

    const live = await db.raceEvent.create({
      data: {
        name: `Palette Enduro ${run}`,
        seriesLabel: series.name,
        seriesId: series.id,
        platform: "Real world",
        date: new Date(),
        status: EventStatus.PUBLISHED,
        sessions: {
          create: {
            name: "Race",
            type: SessionType.RACE,
            startsAt: new Date(),
            endsAt: new Date(Date.now() + 8 * 60 * 60 * 1000),
            status: SessionStatus.LIVE,
          },
        },
      },
    });
    liveEventId = live.id;
  });

  afterAll(async () => {
    if (!ENABLED) return;
    /*
     * Written to survive a setup that fell over halfway. A teardown that
     * throws on an undefined id leaves every row it had not reached yet in
     * the database, and the next run then fails on a unique name for reasons
     * that have nothing to do with the code under test.
     */
    const ids = (values: (string | undefined)[]) =>
      values.filter((value): value is string => Boolean(value));

    const eventIds = ids([eventId, liveEventId]);
    if (eventIds.length > 0) {
      await db.eventSession.deleteMany({ where: { eventId: { in: eventIds } } });
      await db.raceEvent.deleteMany({ where: { id: { in: eventIds } } });
    }
    // Events first: RaceEvent.seriesId is SetNull, so deleting the series
    // would orphan them rather than take them with it.
    await db.series.deleteMany({ where: { slug: `palette-cup-${run}` } });
    await db.team.deleteMany({ where: { slug: `palette-racing-${run}` } });
    await db.user.deleteMany({
      where: { authProviderId: { startsWith: `clerk_palette-` } },
    });
    await db.$disconnect();
  });

  it("gives a manager their team's console", async () => {
    const contexts = await manager.caller.command.contexts();
    const team = contexts.teams.find((entry) => entry.slug === `palette-racing-${run}`);
    expect(team?.canManage).toBe(true);

    const commands = buildCommands(contexts);
    expect(
      commands.some(
        (command) => command.href === `/teams/palette-racing-${run}/manage?tab=garage`,
      ),
    ).toBe(true);
  });

  it("gives a driver the team but never its console", async () => {
    const contexts = await driver.caller.command.contexts();
    const team = contexts.teams.find((entry) => entry.slug === `palette-racing-${run}`);
    expect(team?.canManage).toBe(false);

    const commands = buildCommands(contexts);
    const theirs = commands.filter((command) =>
      command.href.includes(`palette-racing-${run}`),
    );
    expect(theirs.length).toBeGreaterThan(0);
    expect(theirs.every((command) => !command.href.includes("/manage"))).toBe(true);
  });

  it("does not leak somebody else's team into the palette at all", async () => {
    const contexts = await official.caller.command.contexts();
    expect(contexts.teams).toHaveLength(0);
    const commands = buildCommands(contexts);
    expect(commands.some((command) => command.href.includes(`palette-racing-${run}`))).toBe(
      false,
    );
  });

  it("gives a series official the weekends they run, with race control", async () => {
    const contexts = await official.caller.command.contexts();
    expect(contexts.events.map((event) => event.id).sort()).toEqual(
      [eventId, liveEventId].sort(),
    );
    expect(contexts.events.every((event) => event.canManage)).toBe(true);

    const commands = buildCommands(contexts);
    // The gate screen has no link anywhere in the event console. Typing its
    // name is the only way to it, which is the point of the whole exercise.
    expect(commands.some((command) => command.href === `/events/${eventId}/gate`)).toBe(true);
  });

  it("surfaces a running session ahead of a scheduled one", async () => {
    const contexts = await official.caller.command.contexts();
    expect(contexts.events[0]!.id).toBe(liveEventId);
    expect(contexts.events[0]!.live).toBe(true);

    const commands = buildCommands(contexts);
    const liveCommand = commands.find((command) => command.id === `event:${liveEventId}`);
    expect(liveCommand?.hint).toBe("Running now");
  });

  it("shows the staff queue only to staff", async () => {
    expect((await manager.caller.command.contexts()).isPlatformStaff).toBe(false);
    expect((await staff.caller.command.contexts()).isPlatformStaff).toBe(true);

    const asStaff = buildCommands(await staff.caller.command.contexts());
    expect(asStaff.some((command) => command.href === "/admin/access")).toBe(true);
  });

  it("finds a published event by name, for anybody", async () => {
    const results = await callerFor(null).command.search({ query: `Palette Round 1 ${run}` });
    expect(results.events.map((event) => event.id)).toContain(eventId);
  });

  it("does not turn up a draft event by name", async () => {
    await db.raceEvent.update({ where: { id: eventId }, data: { status: EventStatus.DRAFT } });
    try {
      const results = await callerFor(null).command.search({ query: `Palette Round 1 ${run}` });
      expect(results.events.map((event) => event.id)).not.toContain(eventId);
    } finally {
      await db.raceEvent.update({
        where: { id: eventId },
        data: { status: EventStatus.PUBLISHED },
      });
    }
  });

  it("finds a team by name even for somebody not in it", async () => {
    const results = await official.caller.command.search({ query: `Palette Racing ${run}` });
    expect(results.teams.map((team) => team.slug)).toContain(`palette-racing-${run}`);
  });

  it("ranks a manager's own console above the public team page", async () => {
    const contexts = await manager.caller.command.contexts();
    const ranked = rankCommands("palette racing", buildCommands(contexts));
    expect(ranked[0]!.command.href).toBe(`/teams/palette-racing-${run}/manage`);
  });
});
