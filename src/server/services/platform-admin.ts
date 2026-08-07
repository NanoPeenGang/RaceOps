import { TRPCError } from "@trpc/server";
import { AccessRequestKind, AccessRequestStatus, PlatformRole } from "@prisma/client";
import type { PrismaClient, User } from "@prisma/client";
import { isSpendable } from "@/lib/access-requests";
import {
  isPlatformOwner,
  ownerEmail,
  PLATFORM_OWNER_EMAIL,
} from "@/lib/platform-owner";

// Re-exported so callers have one place to reach for platform standing; the
// identity itself lives in a dependency-free module the seed script can load.
export { isPlatformOwner, PLATFORM_OWNER_EMAIL };

/**
 * Who can review access requests, and how the first one of them exists.
 *
 * The bootstrap problem is real: access requests are reviewed by platform
 * admins, and on a fresh deployment there are none, so the first request would
 * sit forever. Two things solve it, and both are read at request time rather
 * than synced into the database column:
 *
 * - **The platform owner** — one address, below, that is always an admin. It
 *   is not a configuration option to get wrong, which is the point: a
 *   deployment that ships with no environment variables set still has somebody
 *   who can open the queue on day one.
 * - **`PLATFORM_ADMIN_EMAILS`** — a comma-separated list, for everybody else
 *   the deployment wants to hand the keys to before there is a database to
 *   promote them in.
 *
 * Reading both live is deliberate. It means whoever controls the deployment
 * can always get in even if somebody demotes every admin row in the database,
 * and removing an address revokes access on the next request rather than
 * leaving a stale grant behind. The column is for admins promoting other
 * people day to day.
 */

/** Addresses granted ADMIN by deployment configuration, owner included. */
function bootstrapAdmins(): string[] {
  const configured = (process.env.PLATFORM_ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  return [ownerEmail(), ...configured];
}

/**
 * Whether anybody can review without a database row saying so.
 *
 * Always true while an owner is set, which is the intended state. It stays a
 * function rather than a constant because the lockout guard below is written
 * against the general case: a fork that empties the owner constant should get
 * the guard back, not a silently unreviewable queue.
 */
export function hasBootstrapAdmin(): boolean {
  return bootstrapAdmins().length > 0;
}

/**
 * Why a demotion is refused, or null if it is allowed.
 *
 * Pure, and separate from the router, because the interesting cases are the
 * ones that are hard to arrange in an integration test: the last admin on a
 * deployment with nothing in the environment, versus the same demotion on one
 * that has a way back in.
 */
export function demotionProblem(input: {
  /** The target is the platform owner. */
  isOwner: boolean;
  /** The caller is demoting themselves. */
  isSelf: boolean;
  /** Admins other than the target. */
  otherAdmins: number;
  /** Somebody can review without a database row. */
  hasBootstrap: boolean;
}): string | null {
  if (input.isOwner) {
    return "The platform owner is always an admin — that is what stops a deployment locking itself out of its own review queue.";
  }
  if (!input.isSelf) return null;
  if (input.otherAdmins > 0 || input.hasBootstrap) return null;
  return "You are the only platform admin and no owner or PLATFORM_ADMIN_EMAILS is configured — promote somebody else first, or nobody can review applications.";
}

/**
 * The role to treat somebody as, once the owner and configuration are taken
 * into account.
 *
 * Case-insensitive on the address, because an email that differs only in case
 * is the same mailbox and locking somebody out over a capital letter would be
 * a support ticket nobody enjoys.
 */
export function effectivePlatformRole(
  user: Pick<User, "email" | "platformRole">,
): PlatformRole {
  if (bootstrapAdmins().includes(user.email.trim().toLowerCase())) {
    return PlatformRole.ADMIN;
  }
  return user.platformRole;
}

export function canReview(role: PlatformRole): boolean {
  return role === PlatformRole.ADMIN || role === PlatformRole.MODERATOR;
}

/** Only a full admin changes somebody else's standing. */
export function canGrantRoles(role: PlatformRole): boolean {
  return role === PlatformRole.ADMIN;
}

export function assertCanReview(
  user: Pick<User, "email" | "platformRole">,
): PlatformRole {
  const role = effectivePlatformRole(user);
  if (!canReview(role)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only platform moderators can review access requests.",
    });
  }
  return role;
}

export function assertCanGrantRoles(
  user: Pick<User, "email" | "platformRole">,
): void {
  if (!canGrantRoles(effectivePlatformRole(user))) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only a platform admin can change somebody's platform role.",
    });
  }
}

/**
 * Finds the approval that lets somebody create this kind of thing.
 *
 * Returns the request so the caller can spend it in the same transaction as
 * the creation. Platform staff bypass the queue entirely — making an admin
 * apply to themselves to create a team is ceremony, and they can approve their
 * own request anyway.
 */
export async function findSpendableApproval(
  db: PrismaClient,
  user: Pick<User, "id" | "email" | "platformRole">,
  kind: AccessRequestKind,
): Promise<{ requestId: string | null; bypassed: boolean }> {
  if (canReview(effectivePlatformRole(user))) {
    return { requestId: null, bypassed: true };
  }

  const approved = await db.accessRequest.findFirst({
    where: {
      requestedById: user.id,
      kind,
      status: AccessRequestStatus.APPROVED,
      fulfilledEntityId: null,
    },
    orderBy: { reviewedAt: "asc" },
  });

  if (!approved || !isSpendable(approved)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: APPROVAL_REQUIRED[kind],
    });
  }
  return { requestId: approved.id, bypassed: false };
}

/**
 * The message somebody sees when they have not been approved.
 *
 * Written to point at the next step rather than to say no. Somebody hitting
 * this is usually a legitimate person who did not know there was a queue, and
 * a bare "forbidden" would read as a bug.
 */
const APPROVAL_REQUIRED: Record<AccessRequestKind, string> = {
  TEAM: "Creating a team needs approval first — apply from /apply and we will come back to you.",
  ORGANIZATION:
    "Creating an organization needs approval first — apply from /apply and we will come back to you.",
  SERIES:
    "Creating a championship needs approval first — apply from /apply and we will come back to you.",
  SPONSOR:
    "A sponsor account needs approval first — apply from /apply and we will come back to you.",
};

/** Marks an approval spent. Called inside the creating transaction. */
export async function spendApproval(
  tx: Pick<PrismaClient, "accessRequest">,
  requestId: string | null,
  entityId: string,
): Promise<void> {
  if (!requestId) return;
  await tx.accessRequest.update({
    where: { id: requestId },
    data: { fulfilledEntityId: entityId, fulfilledAt: new Date() },
  });
}

/**
 * Whether somebody may act as a sponsor.
 *
 * Platform staff included, for the same reason as above. Everyone else needs
 * an approved SPONSOR request — which, unlike the other kinds, is never spent:
 * there is nothing to create, so the approval is the grant.
 */
export async function hasSponsorAccess(
  db: PrismaClient,
  user: Pick<User, "id" | "email" | "platformRole">,
): Promise<boolean> {
  if (canReview(effectivePlatformRole(user))) return true;
  const approved = await db.accessRequest.findFirst({
    where: {
      requestedById: user.id,
      kind: AccessRequestKind.SPONSOR,
      status: AccessRequestStatus.APPROVED,
    },
    select: { id: true },
  });
  return approved !== null;
}

export async function assertSponsorAccess(
  db: PrismaClient,
  user: Pick<User, "id" | "email" | "platformRole">,
): Promise<void> {
  if (await hasSponsorAccess(db, user)) return;
  throw new TRPCError({
    code: "FORBIDDEN",
    message: APPROVAL_REQUIRED.SPONSOR,
  });
}
