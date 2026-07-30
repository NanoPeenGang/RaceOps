import { LogCategory, Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";

/**
 * Writing to the officials' log.
 *
 * Entries are written as things happen rather than reconstructed afterwards,
 * because reconstructing "when did the safety car come out" from a mutated
 * `flagState` column is impossible — the column only holds the current value.
 *
 * Like the audit trail, log writes are best-effort: race control suspending a
 * session must not fail because the log row did.
 */

type Db = PrismaClient | Prisma.TransactionClient;

export interface LogInput {
  eventId: string;
  sessionId?: string | null;
  category: LogCategory;
  summary: string;
  detail?: string | null;
  officialId?: string | null;
  /// True for entries the system generated rather than an official typing.
  automatic?: boolean;
  /**
   * Whether the entry goes straight into the public bulletin. Generated
   * entries default to published — a flag change and a penalty are already
   * public facts — while hand-written notes start internal.
   */
  published?: boolean;
  occurredAt?: Date;
  incidentId?: string | null;
  penaltyId?: string | null;
}

export async function logOfficialAction(
  db: Db,
  input: LogInput,
): Promise<void> {
  try {
    await db.officialLogEntry.create({
      data: {
        eventId: input.eventId,
        sessionId: input.sessionId ?? null,
        category: input.category,
        summary: input.summary,
        detail: input.detail ?? null,
        officialId: input.officialId ?? null,
        automatic: input.automatic ?? true,
        published: input.published ?? input.automatic ?? true,
        occurredAt: input.occurredAt ?? new Date(),
        incidentId: input.incidentId ?? null,
        penaltyId: input.penaltyId ?? null,
      },
    });
  } catch (error) {
    console.error("officials log write failed", { input, error });
  }
}
