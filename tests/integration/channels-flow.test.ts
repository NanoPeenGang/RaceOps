import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ChannelKind, PrismaClient, TeamRole } from "@prisma/client";
import { createCaller } from "@/server/trpc/root";

/**
 * Department channels and direct messages, end to end.
 *
 * Everything here is a privacy test. The claim the feature makes is that a
 * department channel is private to its department and that membership tracks
 * the roster automatically — so what is worth proving is that the wrong person
 * cannot read it, cannot see that it exists, and stops being able to the day
 * their role changes. Opt in with RUN_DB_TESTS=1.
 */
const ENABLED = process.env.RUN_DB_TESTS === "1";
const db = ENABLED ? new PrismaClient() : (null as unknown as PrismaClient);

function callerFor(clerkUserId: string) {
  return createCaller({ db, clerkUserId, headers: new Headers() });
}

describe.skipIf(!ENABLED)("channels and messages (integration)", () => {
  const run = Date.now();
  let teamId: string;
  let engineerUserId: string;
  let manager: ReturnType<typeof callerFor>;
  let engineer: ReturnType<typeof callerFor>;
  let driver: ReturnType<typeof callerFor>;
  let outsider: ReturnType<typeof callerFor>;
  const userIds: string[] = [];

  async function makeUser(suffix: string, role: TeamRole | null) {
    const user = await db.user.create({
      data: {
        email: `${suffix}_${run}@example.test`,
        authProviderId: `clerk_${suffix}_${run}`,
        profile: { create: { displayName: suffix } },
      },
    });
    userIds.push(user.id);
    if (role) {
      await db.teamMembership.create({
        data: { teamId, userId: user.id, role },
      });
    }
    return { caller: callerFor(user.authProviderId), id: user.id };
  }

  beforeAll(async () => {
    if (!ENABLED) return;
    const team = await db.team.create({
      data: { name: `Channel Test ${run}`, slug: `channel-test-${run}` },
    });
    teamId = team.id;

    manager = (await makeUser("cmanager", TeamRole.MANAGER)).caller;
    const eng = await makeUser("cengineer", TeamRole.ENGINEER);
    engineer = eng.caller;
    engineerUserId = eng.id;
    driver = (await makeUser("cdriver", TeamRole.DRIVER)).caller;
    outsider = (await makeUser("coutsider", null)).caller;
  });

  afterAll(async () => {
    if (!ENABLED) return;
    await db.team.deleteMany({ where: { id: teamId } });
    await db.user.deleteMany({ where: { id: { in: userIds } } });
    await db.$disconnect();
  });

  // -- Creating ------------------------------------------------------------

  it("only lets whoever runs the scope create a channel", async () => {
    await expect(
      engineer.channel.create({
        scope: { teamId },
        name: "Sneaky",
        teamRoles: [TeamRole.ENGINEER],
      }),
    ).rejects.toThrow(/runs this team/i);
  });

  it("refuses a department nobody can enter", async () => {
    await expect(
      manager.channel.create({ scope: { teamId }, name: "Nobody" }),
    ).rejects.toThrow(/at least one role/i);
  });

  it("refuses an open channel carrying a role filter", async () => {
    await expect(
      manager.channel.create({
        scope: { teamId },
        name: "Contradiction",
        kind: ChannelKind.OPEN,
        teamRoles: [TeamRole.CREW],
      }),
    ).rejects.toThrow(/whole scope/i);
  });

  it("refuses a second channel with the same name in one scope", async () => {
    await manager.channel.create({
      scope: { teamId },
      name: "Engineering",
      teamRoles: [TeamRole.ENGINEER],
    });
    await expect(
      manager.channel.create({
        scope: { teamId },
        name: "Engineering",
        teamRoles: [TeamRole.ENGINEER],
      }),
    ).rejects.toThrow(/already a channel/i);
  });

  // -- Who can see it ------------------------------------------------------

  it("shows the channel to the department", async () => {
    const list = await engineer.channel.list({ scope: { teamId } });
    expect(list.channels.map((room) => room.name)).toContain("Engineering");
  });

  it("hides it from a team-mate in another department", async () => {
    // Not just locked — hidden. A room list showing channels you cannot open
    // tells everyone what departments exist and roughly who is in them.
    const list = await driver.channel.list({ scope: { teamId } });
    expect(list.channels.map((room) => room.name)).not.toContain("Engineering");
  });

  it("shows it to the manager, who has to be able to moderate", async () => {
    const list = await manager.channel.list({ scope: { teamId } });
    expect(list.channels.map((room) => room.name)).toContain("Engineering");
    expect(list.canManage).toBe(true);
  });

  it("shows nothing at all to somebody off the team", async () => {
    const list = await outsider.channel.list({ scope: { teamId } });
    expect(list.channels).toEqual([]);
    expect(list.canManage).toBe(false);
  });

  it("offers the remaining suggestions and drops the one already made", async () => {
    const list = await manager.channel.list({ scope: { teamId } });
    expect(list.suggestions.map((s) => s.slug)).not.toContain("engineering");
    expect(list.suggestions.length).toBeGreaterThan(0);
  });

  // -- Posting -------------------------------------------------------------

  it("lets the department post and read", async () => {
    const channelId = await engineeringChannelId();
    await engineer.chat.send({ scope: { channelId }, body: "Rear bar softer." });

    const room = await engineer.chat.forRoom({ scope: { channelId } });
    expect(room.messages.map((m) => m.body)).toContain("Rear bar softer.");
  });

  it("refuses a read from another department", async () => {
    const channelId = await engineeringChannelId();
    await expect(
      driver.chat.forRoom({ scope: { channelId } }),
    ).rejects.toThrow(/different department/i);
  });

  it("refuses a post from another department", async () => {
    const channelId = await engineeringChannelId();
    await expect(
      driver.chat.send({ scope: { channelId }, body: "Let me in" }),
    ).rejects.toThrow(/different department/i);
  });

  // -- Membership follows the roster ---------------------------------------

  it("closes the room the day the role changes", async () => {
    // The whole reason membership is derived rather than stored: nobody has to
    // remember to prune the channel when somebody moves job.
    const channelId = await engineeringChannelId();
    await expect(
      engineer.chat.forRoom({ scope: { channelId } }),
    ).resolves.toBeTruthy();

    await db.teamMembership.update({
      where: { teamId_userId: { teamId, userId: engineerUserId } },
      data: { role: TeamRole.DRIVER },
    });
    await expect(
      engineer.chat.forRoom({ scope: { channelId } }),
    ).rejects.toThrow(/different department/i);

    await db.teamMembership.update({
      where: { teamId_userId: { teamId, userId: engineerUserId } },
      data: { role: TeamRole.ENGINEER },
    });
  });

  it("closes it the day somebody leaves the team", async () => {
    const channelId = await engineeringChannelId();
    await db.teamMembership.update({
      where: { teamId_userId: { teamId, userId: engineerUserId } },
      data: { endDate: new Date() },
    });
    await expect(
      engineer.chat.forRoom({ scope: { channelId } }),
    ).rejects.toThrow();

    await db.teamMembership.update({
      where: { teamId_userId: { teamId, userId: engineerUserId } },
      data: { endDate: null },
    });
  });

  // -- Archiving -----------------------------------------------------------

  it("archives rather than deletes, and archived rooms stay readable", async () => {
    const channelId = await engineeringChannelId();
    await manager.channel.archive({ channelId, archived: true });

    const room = await engineer.chat.forRoom({ scope: { channelId } });
    expect(room.messages.length).toBeGreaterThan(0);

    await expect(
      engineer.chat.send({ scope: { channelId }, body: "still here?" }),
    ).rejects.toThrow(/archived/i);

    await manager.channel.archive({ channelId, archived: false });
  });

  // -- Direct messages -----------------------------------------------------

  it("finds the same thread whichever side opens it", async () => {
    const first = await engineer.message.openWith({
      userIds: [await userIdFor("cdriver")],
    });
    const second = await driver.message.openWith({
      userIds: [engineerUserId],
    });
    // Two threads side by side, each holding half a conversation, is the
    // failure `pairKey` exists to prevent.
    expect(second.threadId).toBe(first.threadId);
    expect(second.created).toBe(false);
  });

  it("keeps a conversation private, without confirming it exists", async () => {
    const { threadId } = await engineer.message.openWith({
      userIds: [await userIdFor("cdriver")],
    });
    // NOT_FOUND rather than FORBIDDEN: whether two other people are talking is
    // itself private, and FORBIDDEN would confirm it.
    await expect(outsider.message.thread({ threadId })).rejects.toThrow(
      /NOT_FOUND|not found/i,
    );
  });

  it("counts unread for the recipient and not for the sender", async () => {
    const { threadId } = await engineer.message.openWith({
      userIds: [await userIdFor("cdriver")],
    });
    await engineer.message.send({ threadId, body: "What did you run here?" });

    const mine = await engineer.message.unreadTotal();
    expect(mine.unread).toBe(0);

    const theirs = await driver.message.thread({ threadId });
    expect(theirs.unread).toBe(1);

    await driver.message.markRead({ threadId });
    expect((await driver.message.unreadTotal()).unread).toBe(0);
  });

  it("notifies the other side", async () => {
    const { threadId } = await engineer.message.openWith({
      userIds: [await userIdFor("cdriver")],
    });
    await engineer.message.send({ threadId, body: "Ping" });

    const driverId = await userIdFor("cdriver");
    const notifications = await db.notification.findMany({
      where: { userId: driverId, type: "DIRECT_MESSAGE" },
    });
    expect(notifications.length).toBeGreaterThan(0);
    expect(notifications[0]!.linkUrl).toContain(threadId);
  });

  it("hides a thread you left and brings it back on a reply", async () => {
    const { threadId } = await engineer.message.openWith({
      userIds: [await userIdFor("coutsider")],
    });
    await engineer.message.send({ threadId, body: "first" });
    await outsider.message.leave({ threadId });

    let inbox = await outsider.message.inbox({});
    expect(inbox.threads.map((t) => t.id)).not.toContain(threadId);

    await engineer.message.send({ threadId, body: "still there?" });
    inbox = await outsider.message.inbox({});
    // A reply to a conversation you left is still addressed to you.
    expect(inbox.threads.map((t) => t.id)).toContain(threadId);
  });

  it("sends direct messages only through message.send", async () => {
    // chat.send would skip the inbox bookkeeping, producing threads that never
    // surface for anyone.
    const { threadId } = await engineer.message.openWith({
      userIds: [await userIdFor("cdriver")],
    });
    await expect(
      engineer.chat.send({ scope: { threadId }, body: "wrong door" }),
    ).rejects.toThrow(/message\.send/);
  });

  it("gives a direct thread no moderator", async () => {
    // There is no organization above a private conversation, so nobody has
    // standing to delete somebody else's words in it.
    const { threadId } = await engineer.message.openWith({
      userIds: [await userIdFor("cdriver")],
    });
    const message = await engineer.message.send({ threadId, body: "mine" });

    await expect(
      driver.chat.remove({ messageId: message.id }),
    ).rejects.toThrow(/author or a moderator/i);
    await expect(
      engineer.chat.remove({ messageId: message.id }),
    ).resolves.toEqual({ deleted: true });
  });

  async function engineeringChannelId(): Promise<string> {
    const channel = await db.chatChannel.findFirstOrThrow({
      where: { teamId, slug: "engineering" },
      select: { id: true },
    });
    return channel.id;
  }

  async function userIdFor(suffix: string): Promise<string> {
    const user = await db.user.findFirstOrThrow({
      where: { authProviderId: `clerk_${suffix}_${run}` },
      select: { id: true },
    });
    return user.id;
  }
});
