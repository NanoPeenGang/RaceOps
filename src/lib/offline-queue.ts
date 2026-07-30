/**
 * The trackside outbox.
 *
 * Marshal posts and scrutineering bays have terrible connectivity. Without
 * this, everything gets written on paper and typed in afterwards from notes,
 * which is the difference between a system that is used at the track and one
 * that is used after it.
 *
 * Everything here is pure so the queueing rules can be tested without a
 * browser. Persistence lives in `offline-store`, replay in the provider.
 */

/**
 * Mutations that may be queued.
 *
 * Deliberately a short allowlist rather than "anything that failed". Two
 * things make a mutation safe to replay minutes or hours later:
 *
 *   1. It records an observation rather than deciding something. A marshal
 *      reporting contact at turn 4 is still true an hour later; race control
 *      moving a session to LIVE is not.
 *   2. Replaying it cannot silently contradict a decision made in between.
 *      Issuing a penalty from a stale queue could land after the stewards
 *      already ruled no further action, and nobody would notice.
 *
 * Everything not on this list fails loudly offline, which is correct — the
 * person needs to know it did not happen.
 */
export const QUEUEABLE_PROCEDURES = [
  "incident.file",
  "scrutineering.recordCheck",
  "session.logConditions",
  "session.pushTiming",
  "log.add",
  "car.allocateTireSet",
] as const;

export type QueueableProcedure = (typeof QUEUEABLE_PROCEDURES)[number];

export function isQueueable(path: string): path is QueueableProcedure {
  return (QUEUEABLE_PROCEDURES as readonly string[]).includes(path);
}

export type QueuedStatus = "pending" | "sending" | "failed";

export interface QueuedMutation {
  /// Client-generated, stable across retries — the replay's identity.
  id: string;
  procedure: QueueableProcedure;
  input: unknown;
  /**
   * Optional logical identity. Two queued writes with the same key are the
   * same action, so the later one replaces the earlier: a timing official
   * correcting a lap time twice offline should send one value, not two.
   */
  dedupeKey?: string;
  /// When the person actually did it — not when it was sent.
  queuedAt: number;
  attempts: number;
  status: QueuedStatus;
  lastError?: string;
  /// Earliest time to try again, from the backoff schedule.
  nextAttemptAt: number;
  /// Shown in the outbox so a person can see what is waiting.
  label: string;
}

/** Attempts before an item is parked for the person to deal with. */
export const MAX_ATTEMPTS = 6;

/**
 * Backoff between attempts, in milliseconds.
 *
 * Starts fast because connectivity at a circuit comes back in seconds when a
 * car moves or a crowd thins, and tops out at a minute so a long outage does
 * not spin the radio.
 */
export function backoffMs(attempts: number): number {
  const schedule = [0, 2_000, 5_000, 15_000, 30_000, 60_000];
  return schedule[Math.min(attempts, schedule.length - 1)];
}

export interface EnqueueInput {
  id: string;
  procedure: QueueableProcedure;
  input: unknown;
  label: string;
  dedupeKey?: string;
  now?: number;
}

/**
 * Adds a mutation to the queue, replacing any earlier one with the same
 * dedupe key.
 *
 * Replacing rather than appending matters: a scrutineer correcting a
 * measurement three times while out of signal means one result, not three,
 * and sending all three would make the final state depend on delivery order.
 */
export function enqueue(
  queue: QueuedMutation[],
  input: EnqueueInput,
): QueuedMutation[] {
  const now = input.now ?? Date.now();
  const item: QueuedMutation = {
    id: input.id,
    procedure: input.procedure,
    input: input.input,
    dedupeKey: input.dedupeKey,
    label: input.label,
    queuedAt: now,
    attempts: 0,
    status: "pending",
    nextAttemptAt: now,
  };

  if (!input.dedupeKey) return [...queue, item];

  const withoutDuplicate = queue.filter(
    (queued) =>
      queued.dedupeKey !== input.dedupeKey || queued.status === "sending",
  );
  return [...withoutDuplicate, item];
}

/**
 * Items due to be sent, oldest first.
 *
 * Order is by when the person did the thing, not when it was queued for
 * retry: two flag notes must reach race control in the order they happened.
 */
export function dueItems(
  queue: QueuedMutation[],
  now: number = Date.now(),
): QueuedMutation[] {
  return queue
    .filter(
      (item) =>
        item.status !== "sending" &&
        item.attempts < MAX_ATTEMPTS &&
        item.nextAttemptAt <= now,
    )
    .sort((a, b) => a.queuedAt - b.queuedAt);
}

/** Marks an item in flight so a second replay pass does not double-send it. */
export function markSending(
  queue: QueuedMutation[],
  id: string,
): QueuedMutation[] {
  return queue.map((item) =>
    item.id === id ? { ...item, status: "sending" as const } : item,
  );
}

/** Removes a delivered item. */
export function markDelivered(
  queue: QueuedMutation[],
  id: string,
): QueuedMutation[] {
  return queue.filter((item) => item.id !== id);
}

/**
 * Records a failure and schedules the retry.
 *
 * `permanent` is for errors that will never succeed on replay — a validation
 * failure, or a FORBIDDEN. Retrying those forever would hide a real problem
 * behind a spinner, so they are parked at the attempt limit immediately for
 * the person to see.
 */
export function markFailed(
  queue: QueuedMutation[],
  id: string,
  error: string,
  options: { permanent?: boolean; now?: number } = {},
): QueuedMutation[] {
  const now = options.now ?? Date.now();
  return queue.map((item) => {
    if (item.id !== id) return item;
    const attempts = options.permanent ? MAX_ATTEMPTS : item.attempts + 1;
    return {
      ...item,
      attempts,
      status: "failed" as const,
      lastError: error,
      nextAttemptAt: now + backoffMs(attempts),
    };
  });
}

/** Items that have given up and need a person to look at them. */
export function parkedItems(queue: QueuedMutation[]): QueuedMutation[] {
  return queue.filter((item) => item.attempts >= MAX_ATTEMPTS);
}

export interface QueueSummary {
  total: number;
  pending: number;
  sending: number;
  parked: number;
  /// The oldest thing still waiting, for "queued 12 minutes ago".
  oldestQueuedAt: number | null;
}

export function summarizeQueue(queue: QueuedMutation[]): QueueSummary {
  const parked = parkedItems(queue);
  return {
    total: queue.length,
    pending: queue.filter(
      (item) => item.status !== "sending" && item.attempts < MAX_ATTEMPTS,
    ).length,
    sending: queue.filter((item) => item.status === "sending").length,
    parked: parked.length,
    oldestQueuedAt:
      queue.length === 0
        ? null
        : Math.min(...queue.map((item) => item.queuedAt)),
  };
}

/**
 * Whether a failure is worth retrying.
 *
 * Network errors and 5xx are transient; a 4xx other than 408/429 means the
 * request itself is wrong and will be wrong again. Getting this backwards
 * either spins forever on a bad request or discards work on a flaky link,
 * and the second is much worse — so anything unrecognised is treated as
 * transient.
 */
export function isRetryable(error: {
  httpStatus?: number;
  code?: string;
}): boolean {
  if (error.httpStatus === undefined) return true;
  if (error.httpStatus >= 500) return true;
  if (error.httpStatus === 408 || error.httpStatus === 429) return true;
  return error.httpStatus < 400;
}
