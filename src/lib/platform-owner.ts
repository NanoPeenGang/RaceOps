/**
 * Who owns this deployment.
 *
 * Deliberately its own module with no imports at all. The seed script runs
 * under bare Node with no path aliases and no bundler, so anything it needs
 * has to be reachable by a relative path and drag nothing behind it — pulling
 * this out of `server/services/platform-admin.ts` is what lets the seed record
 * the owner's admin row without importing tRPC and the Prisma client's whole
 * type surface to do it.
 *
 * The rest of the platform-role logic lives in that service; only the identity
 * is here.
 */

/**
 * The address that is always a platform admin.
 *
 * Baked in rather than defaulting to nobody. "The owner is whoever the
 * environment says" fails in exactly the case that matters — a deployment
 * whose environment is the thing that is wrong — and the failure is silent:
 * the review queue still exists, applications still arrive, and nobody on
 * earth can open it.
 */
export const PLATFORM_OWNER_EMAIL = "noah.borkowski586@gmail.com";

/**
 * The owner address in force, honouring the `PLATFORM_OWNER_EMAIL` override.
 *
 * Read at call time rather than at module load so a fork, a staging copy or a
 * change of hands needs no code edit, and so tests can move it.
 */
export function ownerEmail(): string {
  const override = process.env.PLATFORM_OWNER_EMAIL?.trim();
  return (override || PLATFORM_OWNER_EMAIL).toLowerCase();
}

/**
 * Case-insensitive on the address, because one differing only in case is the
 * same mailbox — and locking the owner out of their own platform over a
 * capital letter is not a rule anybody meant to write.
 */
export function isPlatformOwner(email: string): boolean {
  return email.trim().toLowerCase() === ownerEmail();
}
