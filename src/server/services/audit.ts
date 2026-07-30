import { AuditAction, Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";

/**
 * The audit trail.
 *
 * Once a championship has consequences, someone will dispute a change, and
 * "the database says so now" is not an answer. Every write here is
 * best-effort: an audit failure must never take down the action it was
 * recording, because a result that will not save because its audit row failed
 * is a worse outcome than a missing audit row.
 *
 * Nothing in this module reads back for editing, and no router exposes a
 * mutation against `AuditEvent`. The trail is append-only.
 */

/** Anything that can run a query — the client, or a transaction handle. */
type Db = PrismaClient | Prisma.TransactionClient;

export interface AuditInput {
  actorId?: string | null;
  action: AuditAction;
  entityType: string;
  entityId: string;
  eventId?: string | null;
  seriesId?: string | null;
  summary: string;
  changes?: Prisma.InputJsonValue | null;
}

export async function recordAudit(db: Db, input: AuditInput): Promise<void> {
  try {
    await db.auditEvent.create({
      data: {
        actorId: input.actorId ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        eventId: input.eventId ?? null,
        seriesId: input.seriesId ?? null,
        summary: input.summary,
        changes: input.changes ?? Prisma.DbNull,
      },
    });
  } catch (error) {
    // Deliberately swallowed: see the module comment. Logged so a broken
    // trail is visible in production rather than silently absent.
    console.error("audit write failed", { input, error });
  }
}

/**
 * Fields that actually changed, as `{ field: { from, to } }`.
 *
 * Only the named fields are compared, so an `updatedAt` bump or an unrelated
 * column never shows up as a change. Returns null when nothing moved, which
 * callers use to skip writing a no-op audit row.
 */
export function diffFields<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
  fields: (keyof T)[],
): Prisma.InputJsonObject | null {
  // Built as a mutable record; `InputJsonObject`'s index signature is
  // read-only, so it is only applied on the way out.
  const changes: Record<string, Prisma.InputJsonValue> = {};
  for (const field of fields) {
    if (!(field in after)) continue;
    const from = before[field];
    const to = after[field];
    if (sameValue(from, to)) continue;
    changes[String(field)] = { from: serialize(from), to: serialize(to) };
  }
  return Object.keys(changes).length > 0 ? changes : null;
}

/** Dates compare by instant; everything else by identity, nulls unified. */
function sameValue(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (a === null || a === undefined) return b === null || b === undefined;
  return a === b;
}

/**
 * JSON-safe form for the `changes` column. Anything the column cannot hold
 * (a Prisma Decimal, a nested relation) is stringified rather than dropped —
 * a slightly lossy audit line still answers "what did it used to say".
 */
function serialize(value: unknown): Prisma.InputJsonValue | null {
  if (value instanceof Date) return value.toISOString();
  if (value === undefined || value === null) return null;
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  return String(value);
}
