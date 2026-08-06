import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ChannelKind,
  InterviewStatus,
  PrismaClient,
  TeamRole,
} from "@prisma/client";
import { createCaller } from "@/server/trpc/root";

/**
 * Guards against N+1 queries coming back.
 *
 * Three endpoints used to run one query per row — `channel.list` resolved a
 * person's standing once per channel, and both `message.inbox` and
 * `message.unreadTotal` counted once per thread. None of them was slow enough
 * to notice on a test fixture, which is exactly why they shipped.
 *
 * So the assertion is not a query budget, which would be brittle and would
 * need rewriting every time a `select` changed. It is that the count does not
 * *grow with the data*: measured over a small set and a larger one, the number
 * of round trips must be identical. That fails loudly for a loop and stays
 * quiet for an honest refactor. Opt in with RUN_DB_TESTS=1.
 */
const ENABLED = process.env.RUN_DB_TESTS === "1";
const base = ENABLED ? new PrismaClient() : (null as unknown as PrismaClient);

/** Wraps a client so every database operation through it is counted. */
function counting(): { db: PrismaClient; reset: () => void; count: () => number } {
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

describe.skipIf(!ENABLED)("query shape (integration)", () => {
  const run = Date.now();
  const meter = ENABLED ? counting() : (null as never);
  let teamId: string;
  let managerAuthId: string;
  let meAuthId: string;
  let meId: string;
  const userIds: string[] = [];

  async function makeUser(suffix: string, role: TeamRole | null) {
    const user = await base.user.create({
      data: {
        email: `${suffix}_${run}@example.test`,
        authProviderId: `clerk_${suffix}_${run}`,
        profile: { create: { displayName: suffix } },
      },
    });
    userIds.push(user.id);
    if (role) {
      await base.teamMembership.create({
        data: { teamId, userId: user.id, role },
      });
    }
    return user;
  }

  beforeAll(async () => {
    if (!ENABLED) return;
    const team = await base.team.create({
      data: { name: `Query Shape ${run}`, slug: `query-shape-${run}` },
    });
    teamId = team.id;

    const manager = await makeUser("qsmanager", TeamRole.OWNER);
    managerAuthId = manager.authProviderId;
    const me = await makeUser("qsme", TeamRole.ENGINEER);
    meAuthId = me.authProviderId;
    meId = me.id;
  });

  afterAll(async () => {
    if (!ENABLED) return;
    await base.team.deleteMany({ where: { id: teamId } });
    await base.user.deleteMany({ where: { id: { in: userIds } } });
    await base.directThread.deleteMany({
      where: { participants: { some: { userId: { in: userIds } } } },
    });
    await base.$disconnect();
    await meter.db.$disconnect();
  });

  async function addChannel(name: string) {
    await base.chatChannel.create({
      data: {
        teamId,
        name,
        slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        kind: ChannelKind.DEPARTMENT,
        teamRoles: [TeamRole.ENGINEER, TeamRole.OWNER],
      },
    });
  }

  async function addThread(index: number) {
    const other = await makeUser(`qsother${index}`, null);
    const thread = await base.directThread.create({
      data: {
        pairKey: [meId, other.id].sort().join(":"),
        participants: {
          create: [{ userId: meId }, { userId: other.id }],
        },
        lastMessageAt: new Date(),
      },
    });
    // Two unread messages from the other side, so the count is non-trivial.
    await base.chatMessage.createMany({
      data: [
        { threadId: thread.id, userId: other.id, body: "one" },
        { threadId: thread.id, userId: other.id, body: "two" },
      ],
    });
  }

  /** Runs an endpoint over a small data set, then a larger one. */
  async function queriesAt(
    grow: () => Promise<void>,
    call: (caller: ReturnType<typeof createCaller>) => Promise<unknown>,
    smallSize: number,
    largeSize: number,
  ): Promise<{ small: number; large: number }> {
    for (let index = 0; index < smallSize; index += 1) await grow();
    const caller = createCaller({
      db: meter.db,
      clerkUserId: meAuthId,
      headers: new Headers(),
    });

    // Warm once so any lazy connection work is not counted as a query.
    await call(caller);
    meter.reset();
    await call(caller);
    const small = meter.count();

    for (let index = smallSize; index < largeSize; index += 1) await grow();
    meter.reset();
    await call(caller);
    const large = meter.count();

    return { small, large };
  }

  it("lists channels in a fixed number of queries", async () => {
    let made = 0;
    const { small, large } = await queriesAt(
      async () => {
        made += 1;
        await addChannel(`Channel ${made}`);
      },
      (caller) => caller.channel.list({ scope: { teamId } }),
      1,
      5,
    );
    expect(small).toBeGreaterThan(0);
    // Five channels must cost what one costs. A per-channel standing lookup
    // would make this 5x.
    expect(large).toBe(small);
  });

  it("still filters correctly with standing resolved once", async () => {
    // The optimisation must not have widened access: an engineer sees the
    // engineers' channel, a driver does not.
    const driver = await makeUser("qsdriver", TeamRole.DRIVER);
    const asDriver = createCaller({
      db: base,
      clerkUserId: driver.authProviderId,
      headers: new Headers(),
    });
    const asEngineer = createCaller({
      db: base,
      clerkUserId: meAuthId,
      headers: new Headers(),
    });

    const forDriver = await asDriver.channel.list({ scope: { teamId } });
    const forEngineer = await asEngineer.channel.list({ scope: { teamId } });
    expect(forDriver.channels).toHaveLength(0);
    expect(forEngineer.channels.length).toBeGreaterThan(0);
    expect(forDriver.canManage).toBe(false);
  });

  it("offers the add button to a manager of a scope with no channels", async () => {
    // This was previously derived from the channel loop, so it had a special
    // case for the empty scope. It now comes straight from standing — worth a
    // test, because the special case is gone.
    const empty = await base.team.create({
      data: { name: `Empty Scope ${run}`, slug: `empty-scope-${run}` },
    });
    const manager = await base.user.findFirstOrThrow({
      where: { authProviderId: managerAuthId },
    });
    await base.teamMembership.create({
      data: { teamId: empty.id, userId: manager.id, role: TeamRole.OWNER },
    });

    const caller = createCaller({
      db: base,
      clerkUserId: managerAuthId,
      headers: new Headers(),
    });
    const list = await caller.channel.list({ scope: { teamId: empty.id } });
    expect(list.channels).toHaveLength(0);
    expect(list.canManage).toBe(true);

    await base.team.delete({ where: { id: empty.id } });
  });

  it("loads the inbox in a fixed number of queries", async () => {
    let made = 0;
    const { small, large } = await queriesAt(
      async () => {
        made += 1;
        await addThread(made);
      },
      (caller) => caller.message.inbox({}),
      1,
      5,
    );
    expect(small).toBeGreaterThan(0);
    expect(large).toBe(small);
  });

  it("counts unread across every thread in a fixed number of queries", async () => {
    const caller = createCaller({
      db: meter.db,
      clerkUserId: meAuthId,
      headers: new Headers(),
    });
    await caller.message.unreadTotal();
    meter.reset();
    const before = await caller.message.unreadTotal();
    const small = meter.count();

    await addThread(99);
    meter.reset();
    const after = await caller.message.unreadTotal();
    const large = meter.count();

    expect(large).toBe(small);
    // And the number is still right: two more unread from the new thread.
    expect(after.unread).toBe(before.unread + 2);
  });

  it("counts unread per thread correctly with mixed read marks", async () => {
    // The batched OR has to honour a *different* read mark per thread, which
    // is the whole reason a single grouped count could not do this.
    const caller = createCaller({
      db: base,
      clerkUserId: meAuthId,
      headers: new Headers(),
    });
    const inbox = await caller.message.inbox({});
    expect(inbox.threads.length).toBeGreaterThan(1);
    expect(inbox.threads.every((thread) => thread.unread === 2)).toBe(true);

    // Read one of them; only that one should drop to zero.
    const target = inbox.threads[0]!;
    await caller.message.markRead({ threadId: target.id });

    const after = await caller.message.inbox({});
    expect(after.threads.find((t) => t.id === target.id)!.unread).toBe(0);
    expect(
      after.threads.filter((t) => t.id !== target.id).every((t) => t.unread === 2),
    ).toBe(true);
  });
});

describe.skipIf(!ENABLED)("interview reply notes (integration)", () => {
  const run = Date.now();
  const userIds: string[] = [];
  let teamId: string;
  let manager: ReturnType<typeof createCaller>;
  let applicant: ReturnType<typeof createCaller>;
  let applicationId: string;

  beforeAll(async () => {
    if (!ENABLED) return;
    const team = await base.team.create({
      data: { name: `Note Test ${run}`, slug: `note-test-${run}` },
    });
    teamId = team.id;

    const managerUser = await base.user.create({
      data: {
        email: `nmanager_${run}@example.test`,
        authProviderId: `clerk_nmanager_${run}`,
        profile: { create: { displayName: "nmanager" } },
      },
    });
    const applicantUser = await base.user.create({
      data: {
        email: `napplicant_${run}@example.test`,
        authProviderId: `clerk_napplicant_${run}`,
        profile: { create: { displayName: "napplicant" } },
      },
    });
    userIds.push(managerUser.id, applicantUser.id);
    await base.teamMembership.create({
      data: { teamId, userId: managerUser.id, role: TeamRole.OWNER },
    });

    const opportunity = await base.opportunity.create({
      data: {
        type: "CREW_JOB",
        title: `Mechanic ${run}`,
        description: "Weekends.",
        postedByTeamId: teamId,
      },
    });
    const application = await base.application.create({
      data: { opportunityId: opportunity.id, applicantId: applicantUser.id },
    });
    applicationId = application.id;

    manager = createCaller({
      db: base,
      clerkUserId: managerUser.authProviderId,
      headers: new Headers(),
    });
    applicant = createCaller({
      db: base,
      clerkUserId: applicantUser.authProviderId,
      headers: new Headers(),
    });
  });

  afterAll(async () => {
    if (!ENABLED) return;
    await base.team.deleteMany({ where: { id: teamId } });
    await base.user.deleteMany({ where: { id: { in: userIds } } });
  });

  it("keeps what the applicant said when they accepted a time", async () => {
    const interview = await manager.hiring.proposeInterview({
      applicationId,
      slots: [new Date(Date.now() + 86_400_000)],
    });
    const booked = await applicant.hiring.respondToInterview({
      interviewId: interview.id,
      slotId: interview.slots[0]!.id,
      note: "Can do, but I may be five minutes late off a call.",
    });

    expect(booked.status).toBe(InterviewStatus.CONFIRMED);
    const stored = await base.interview.findUniqueOrThrow({
      where: { id: interview.id },
    });
    expect(stored.responseNote).toContain("five minutes late");
    // And the agenda is untouched — the note used to be written over it.
    expect(stored.agenda).toBeNull();
  });

  it("keeps the reason a decline was a decline", async () => {
    // The one that matters: "I'm at Sebring that weekend" is the difference
    // between proposing three new times and writing somebody off.
    const interview = await manager.hiring.proposeInterview({
      applicationId,
      slots: [new Date(Date.now() + 172_800_000)],
      agenda: "Half an hour with the crew chief.",
    });
    await applicant.hiring.respondToInterview({
      interviewId: interview.id,
      slotId: null,
      note: "None of those work — I'm racing at Sebring that weekend.",
    });

    const stored = await base.interview.findUniqueOrThrow({
      where: { id: interview.id },
    });
    expect(stored.status).toBe(InterviewStatus.DECLINED);
    expect(stored.responseNote).toContain("Sebring");
    expect(stored.agenda).toBe("Half an hour with the crew chief.");
  });

  it("leaves the note null when none is given", async () => {
    const interview = await manager.hiring.proposeInterview({
      applicationId,
      slots: [new Date(Date.now() + 259_200_000)],
    });
    await applicant.hiring.respondToInterview({
      interviewId: interview.id,
      slotId: null,
    });
    const stored = await base.interview.findUniqueOrThrow({
      where: { id: interview.id },
    });
    expect(stored.responseNote).toBeNull();
  });
});
