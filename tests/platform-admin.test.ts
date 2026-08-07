import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PlatformRole } from "@prisma/client";
import {
  canGrantRoles,
  canReview,
  demotionProblem,
  effectivePlatformRole,
  hasBootstrapAdmin,
  isPlatformOwner,
  PLATFORM_OWNER_EMAIL,
} from "@/server/services/platform-admin";

/**
 * Who is an admin before anybody has been made one.
 *
 * The failure this guards against is quiet and total: a deployment where the
 * review queue exists, applications arrive, and nobody on earth can open it.
 * Nothing surfaces that — the applications just sit — so the standing has to
 * come from somewhere that cannot be misconfigured into nonexistence.
 */

const OWNER = { email: PLATFORM_OWNER_EMAIL, platformRole: PlatformRole.MEMBER };

describe("the platform owner", () => {
  const saved = {
    owner: process.env.PLATFORM_OWNER_EMAIL,
    admins: process.env.PLATFORM_ADMIN_EMAILS,
  };

  beforeEach(() => {
    delete process.env.PLATFORM_OWNER_EMAIL;
    delete process.env.PLATFORM_ADMIN_EMAILS;
  });

  afterEach(() => {
    process.env.PLATFORM_OWNER_EMAIL = saved.owner;
    process.env.PLATFORM_ADMIN_EMAILS = saved.admins;
  });

  it("is an admin on a database that has never been touched", () => {
    // The MEMBER column is the whole point: a fresh sign-in has no admin row.
    expect(effectivePlatformRole(OWNER)).toBe(PlatformRole.ADMIN);
    expect(canReview(effectivePlatformRole(OWNER))).toBe(true);
    expect(canGrantRoles(effectivePlatformRole(OWNER))).toBe(true);
  });

  it("stays an admin with the environment empty", () => {
    process.env.PLATFORM_ADMIN_EMAILS = "";
    expect(effectivePlatformRole(OWNER)).toBe(PlatformRole.ADMIN);
    expect(hasBootstrapAdmin()).toBe(true);
  });

  it("is matched regardless of case or stray whitespace", () => {
    // An address differing only in case is the same mailbox, and locking the
    // owner out of their own platform over a capital letter is not a rule.
    expect(isPlatformOwner(`  ${PLATFORM_OWNER_EMAIL.toUpperCase()} `)).toBe(
      true,
    );
    expect(
      effectivePlatformRole({
        email: PLATFORM_OWNER_EMAIL.toUpperCase(),
        platformRole: PlatformRole.MEMBER,
      }),
    ).toBe(PlatformRole.ADMIN);
  });

  it("does not make everybody else an admin", () => {
    const other = {
      email: "somebody@example.test",
      platformRole: PlatformRole.MEMBER,
    };
    expect(isPlatformOwner(other.email)).toBe(false);
    expect(effectivePlatformRole(other)).toBe(PlatformRole.MEMBER);
  });

  it("can be moved to another address without a code change", () => {
    process.env.PLATFORM_OWNER_EMAIL = "newowner@example.test";
    expect(isPlatformOwner("newowner@example.test")).toBe(true);
    // And the old one goes back to whatever the database says.
    expect(effectivePlatformRole(OWNER)).toBe(PlatformRole.MEMBER);
  });

  it("falls back to the baked-in address when the override is blank", () => {
    // "The owner is whoever the environment says" fails exactly when the
    // environment is the thing that is wrong.
    process.env.PLATFORM_OWNER_EMAIL = "   ";
    expect(isPlatformOwner(PLATFORM_OWNER_EMAIL)).toBe(true);
  });

  it("still honours the configured admin list alongside the owner", () => {
    process.env.PLATFORM_ADMIN_EMAILS = "ops@example.test, second@example.test";
    for (const email of ["ops@example.test", "second@example.test"]) {
      expect(
        effectivePlatformRole({ email, platformRole: PlatformRole.MEMBER }),
      ).toBe(PlatformRole.ADMIN);
    }
    expect(effectivePlatformRole(OWNER)).toBe(PlatformRole.ADMIN);
  });

  it("keeps a moderator a moderator", () => {
    const moderator = {
      email: "mod@example.test",
      platformRole: PlatformRole.MODERATOR,
    };
    expect(effectivePlatformRole(moderator)).toBe(PlatformRole.MODERATOR);
    expect(canReview(PlatformRole.MODERATOR)).toBe(true);
    // Reviewing is not appointing.
    expect(canGrantRoles(PlatformRole.MODERATOR)).toBe(false);
  });
});

describe("refusing a demotion that would close the queue", () => {
  it("never demotes the owner, by anyone, for any reason", () => {
    expect(
      demotionProblem({
        isOwner: true,
        isSelf: false,
        otherAdmins: 5,
        hasBootstrap: true,
      }),
    ).toMatch(/owner/i);
  });

  it("refuses the last admin demoting themselves with no way back in", () => {
    expect(
      demotionProblem({
        isOwner: false,
        isSelf: true,
        otherAdmins: 0,
        hasBootstrap: false,
      }),
    ).toMatch(/only platform admin/i);
  });

  it("allows it while somebody else can still review", () => {
    expect(
      demotionProblem({
        isOwner: false,
        isSelf: true,
        otherAdmins: 1,
        hasBootstrap: false,
      }),
    ).toBeNull();
  });

  it("allows it while the environment is a way back in", () => {
    expect(
      demotionProblem({
        isOwner: false,
        isSelf: true,
        otherAdmins: 0,
        hasBootstrap: true,
      }),
    ).toBeNull();
  });

  it("does not stop an admin demoting somebody else", () => {
    // The lockout guard is about the caller's own standing; demoting another
    // admin down to nobody is a decision an admin is allowed to make.
    expect(
      demotionProblem({
        isOwner: false,
        isSelf: false,
        otherAdmins: 0,
        hasBootstrap: false,
      }),
    ).toBeNull();
  });
});
