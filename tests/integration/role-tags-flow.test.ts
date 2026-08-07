import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PlatformRole,
  PrismaClient,
  ProfileType,
  RealWorldRole,
  SimRole,
} from "@prisma/client";
import { createCaller } from "@/server/trpc/root";
import { MAX_ROLE_TAGS_PER_DOMAIN } from "@/lib/roles";

/** Profile role tags and role-filtered discovery. Opt in with RUN_DB_TESTS=1. */
const ENABLED = process.env.RUN_DB_TESTS === "1";
const db = ENABLED ? new PrismaClient() : (null as unknown as PrismaClient);

function callerFor(clerkUserId: string | null) {
  return createCaller({ db, clerkUserId, headers: new Headers() });
}

async function makeUser(
  suffix: string,
  profileTypes: ProfileType[],
  location?: string,
) {
  const user = await db.user.create({
    data: {
      email: `${suffix}@example.test`,
      authProviderId: `clerk_${suffix}`,
      // Platform staff, so these fixtures bypass the access-request queue —
      // the queue itself is exercised in access-flow.test.ts, and making every
      // suite apply for a team first would test one gate thirty times.
      platformRole: PlatformRole.ADMIN,
      profileTypes,
      profile: { create: { displayName: suffix, location } },
    },
  });
  return { user, caller: callerFor(user.authProviderId) };
}

const anon = () => callerFor(null);

describe.skipIf(!ENABLED)("profile role tags (integration)", () => {
  const run = Date.now();
  let engineer: Awaited<ReturnType<typeof makeUser>>;
  let marshal: Awaited<ReturnType<typeof makeUser>>;
  let untagged: Awaited<ReturnType<typeof makeUser>>;

  beforeAll(async () => {
    engineer = await makeUser(
      `roleeng_${run}`,
      [ProfileType.ENGINEER],
      "Lisbon, Portugal",
    );
    marshal = await makeUser(
      `rolemar_${run}`,
      [ProfileType.CREW],
      "Spa, Belgium",
    );
    untagged = await makeUser(`roleplain_${run}`, [ProfileType.DRIVER]);

    await engineer.caller.profile.update({
      simRoles: [SimRole.RACE_ENGINEER, SimRole.STRATEGIST],
      realWorldRoles: [RealWorldRole.DATA_ENGINEER],
    });
    await marshal.caller.profile.update({
      realWorldRoles: [RealWorldRole.MARSHAL, RealWorldRole.SCRUTINEER],
    });
  });

  afterAll(async () => {
    if (!ENABLED) return;
    await db.user.deleteMany({
      where: {
        authProviderId: {
          in: [engineer, marshal, untagged].map(
            (u) => u.user.authProviderId!,
          ),
        },
      },
    });
    await db.$disconnect();
  });

  it("stores tags on the profile and serves them publicly", async () => {
    const profile = await anon().profile.byUserId({
      userId: engineer.user.id,
    });
    expect(profile.simRoles).toEqual([
      SimRole.RACE_ENGINEER,
      SimRole.STRATEGIST,
    ]);
    expect(profile.realWorldRoles).toEqual([RealWorldRole.DATA_ENGINEER]);
  });

  it("stores tags in canonical order regardless of click order", async () => {
    await engineer.caller.profile.update({
      // Reverse picker order, with a duplicate.
      simRoles: [
        SimRole.STRATEGIST,
        SimRole.OVAL_DRIVER,
        SimRole.STRATEGIST,
        SimRole.RACE_ENGINEER,
      ],
    });
    const profile = await anon().profile.byUserId({
      userId: engineer.user.id,
    });
    expect(profile.simRoles).toEqual([
      SimRole.OVAL_DRIVER,
      SimRole.RACE_ENGINEER,
      SimRole.STRATEGIST,
    ]);
  });

  it("leaves the other domain alone when only one is updated", async () => {
    await engineer.caller.profile.update({
      simRoles: [SimRole.RACE_ENGINEER],
    });
    const profile = await anon().profile.byUserId({
      userId: engineer.user.id,
    });
    expect(profile.realWorldRoles).toEqual([RealWorldRole.DATA_ENGINEER]);
  });

  it("clears tags when given an empty array", async () => {
    await marshal.caller.profile.update({ simRoles: [] });
    const profile = await anon().profile.byUserId({ userId: marshal.user.id });
    expect(profile.simRoles).toEqual([]);
    // The real-world tags are untouched.
    expect(profile.realWorldRoles).toContain(RealWorldRole.MARSHAL);
  });

  it("refuses more tags than the per-domain cap", async () => {
    const tooMany = Object.values(RealWorldRole).slice(
      0,
      MAX_ROLE_TAGS_PER_DOMAIN + 1,
    );
    await expect(
      marshal.caller.profile.update({ realWorldRoles: tooMany }),
    ).rejects.toThrow();
  });

  it("only ever writes the caller's own profile", async () => {
    // There is no id to pass — the mutation is scoped to the session — so the
    // guarantee is that one user's update cannot touch another's row.
    await untagged.caller.profile.update({
      simRoles: [SimRole.CONTENT_CREATOR],
    });
    const other = await anon().profile.byUserId({ userId: marshal.user.id });
    expect(other.simRoles).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Discovery
  // -------------------------------------------------------------------------

  it("filters discovery by a sim role", async () => {
    const results = await anon().search.profiles({
      simRole: SimRole.RACE_ENGINEER,
    });
    const ids = results.users.map((u) => u.id);
    expect(ids).toContain(engineer.user.id);
    expect(ids).not.toContain(marshal.user.id);
    expect(ids).not.toContain(untagged.user.id);
  });

  it("filters discovery by a real-world role", async () => {
    const results = await anon().search.profiles({
      realWorldRole: RealWorldRole.MARSHAL,
    });
    const ids = results.users.map((u) => u.id);
    expect(ids).toContain(marshal.user.id);
    expect(ids).not.toContain(engineer.user.id);
  });

  it("returns tags on search results so cards can render them", async () => {
    const results = await anon().search.profiles({
      realWorldRole: RealWorldRole.SCRUTINEER,
    });
    const hit = results.users.find((u) => u.id === marshal.user.id)!;
    expect(hit.profile?.realWorldRoles).toContain(RealWorldRole.SCRUTINEER);
  });

  it("combines a role filter with location", async () => {
    const matching = await anon().search.profiles({
      simRole: SimRole.RACE_ENGINEER,
      location: "lisbon",
    });
    expect(matching.users.map((u) => u.id)).toContain(engineer.user.id);

    // Both conditions have to hold — previously one silently overwrote the
    // other, which made a combined filter return the wrong people.
    const conflicting = await anon().search.profiles({
      simRole: SimRole.RACE_ENGINEER,
      location: "spa",
    });
    expect(conflicting.users.map((u) => u.id)).not.toContain(
      engineer.user.id,
    );
  });

  it("returns everyone with no role filter applied", async () => {
    const results = await anon().search.profiles({ query: `role` });
    const ids = results.users.map((u) => u.id);
    for (const person of [engineer, marshal, untagged]) {
      expect(ids).toContain(person.user.id);
    }
  });
});
