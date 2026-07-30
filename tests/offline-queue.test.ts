import { describe, expect, it } from "vitest";
import {
  backoffMs,
  dueItems,
  enqueue,
  isQueueable,
  isRetryable,
  markDelivered,
  markFailed,
  markSending,
  MAX_ATTEMPTS,
  parkedItems,
  summarizeQueue,
  type QueuedMutation,
} from "@/lib/offline-queue";

const NOW = 1_700_000_000_000;

function add(
  queue: QueuedMutation[],
  id: string,
  overrides: Partial<Parameters<typeof enqueue>[1]> = {},
) {
  return enqueue(queue, {
    id,
    procedure: "incident.file",
    input: { summary: id },
    label: `Incident: ${id}`,
    now: NOW,
    ...overrides,
  });
}

describe("isQueueable", () => {
  it("allows observations that stay true when replayed later", () => {
    expect(isQueueable("incident.file")).toBe(true);
    expect(isQueueable("scrutineering.recordCheck")).toBe(true);
    expect(isQueueable("session.logConditions")).toBe(true);
  });

  it("refuses decisions that could land after they were overtaken", () => {
    // A penalty replayed from a stale queue could arrive after the stewards
    // already ruled no further action.
    expect(isQueueable("penalty.issue")).toBe(false);
    expect(isQueueable("incident.setStatus")).toBe(false);
    expect(isQueueable("event.setRegistrationStatus")).toBe(false);
    expect(isQueueable("session.setLiveState")).toBe(false);
  });
});

describe("enqueue", () => {
  it("appends when there is no dedupe key", () => {
    const queue = add(add([], "a"), "b");
    expect(queue.map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("replaces an earlier write with the same dedupe key", () => {
    // A scrutineer correcting a measurement three times offline means one
    // result, not three; sending all three makes the outcome depend on
    // delivery order.
    let queue = add([], "first", { dedupeKey: "check-1" });
    queue = add(queue, "second", { dedupeKey: "check-1" });
    expect(queue).toHaveLength(1);
    expect(queue[0].id).toBe("second");
  });

  it("does not replace an item already in flight", () => {
    let queue = add([], "first", { dedupeKey: "check-1" });
    queue = markSending(queue, "first");
    queue = add(queue, "second", { dedupeKey: "check-1" });
    expect(queue).toHaveLength(2);
  });

  it("keeps different dedupe keys apart", () => {
    let queue = add([], "a", { dedupeKey: "check-1" });
    queue = add(queue, "b", { dedupeKey: "check-2" });
    expect(queue).toHaveLength(2);
  });

  it("records when the person acted, not when it was queued for retry", () => {
    const [item] = add([], "a");
    expect(item.queuedAt).toBe(NOW);
    expect(item.attempts).toBe(0);
    expect(item.status).toBe("pending");
  });
});

describe("dueItems", () => {
  it("returns items oldest first, by when they happened", () => {
    let queue = add([], "later");
    queue = enqueue(queue, {
      id: "earlier",
      procedure: "incident.file",
      input: {},
      label: "earlier",
      now: NOW - 60_000,
    });
    expect(dueItems(queue, NOW).map((item) => item.id)).toEqual([
      "earlier",
      "later",
    ]);
  });

  it("skips items already in flight", () => {
    const queue = markSending(add([], "a"), "a");
    expect(dueItems(queue, NOW)).toEqual([]);
  });

  it("respects the backoff window", () => {
    const queue = markFailed(add([], "a"), "a", "network", { now: NOW });
    expect(dueItems(queue, NOW)).toEqual([]);
    expect(dueItems(queue, NOW + 2_000)).toHaveLength(1);
  });

  it("skips items that have given up", () => {
    let queue = add([], "a");
    for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
      queue = markFailed(queue, "a", "network", { now: NOW });
    }
    expect(dueItems(queue, NOW + 10_000_000)).toEqual([]);
  });
});

describe("backoffMs", () => {
  it("retries immediately the first time, then backs off", () => {
    expect(backoffMs(0)).toBe(0);
    expect(backoffMs(1)).toBe(2_000);
    expect(backoffMs(2)).toBe(5_000);
  });

  it("tops out rather than growing without bound", () => {
    expect(backoffMs(5)).toBe(60_000);
    expect(backoffMs(50)).toBe(60_000);
  });
});

describe("markFailed", () => {
  it("counts the attempt and schedules the retry", () => {
    const [item] = markFailed(add([], "a"), "a", "timeout", { now: NOW });
    expect(item.attempts).toBe(1);
    expect(item.lastError).toBe("timeout");
    expect(item.nextAttemptAt).toBe(NOW + 2_000);
  });

  it("parks a permanent failure immediately", () => {
    // Retrying a validation error forever would hide a real problem behind a
    // spinner for the rest of the meeting.
    const [item] = markFailed(add([], "a"), "a", "Car number taken", {
      permanent: true,
      now: NOW,
    });
    expect(item.attempts).toBe(MAX_ATTEMPTS);
    expect(parkedItems([item])).toHaveLength(1);
  });

  it("leaves other items alone", () => {
    const queue = markFailed(add(add([], "a"), "b"), "a", "x", { now: NOW });
    expect(queue.find((item) => item.id === "b")?.attempts).toBe(0);
  });
});

describe("markDelivered", () => {
  it("removes the item", () => {
    expect(markDelivered(add(add([], "a"), "b"), "a")).toHaveLength(1);
  });
});

describe("summarizeQueue", () => {
  it("counts what is waiting, in flight and parked", () => {
    let queue = add(add(add([], "a"), "b"), "c");
    queue = markSending(queue, "b");
    queue = markFailed(queue, "c", "gone", { permanent: true, now: NOW });

    const summary = summarizeQueue(queue);
    expect(summary.total).toBe(3);
    expect(summary.sending).toBe(1);
    expect(summary.parked).toBe(1);
    expect(summary.pending).toBe(1);
    expect(summary.oldestQueuedAt).toBe(NOW);
  });

  it("reports an empty queue without inventing a timestamp", () => {
    const summary = summarizeQueue([]);
    expect(summary.total).toBe(0);
    expect(summary.oldestQueuedAt).toBeNull();
  });
});

describe("isRetryable", () => {
  it("retries server errors and network failures", () => {
    expect(isRetryable({ httpStatus: 500 })).toBe(true);
    expect(isRetryable({ httpStatus: 503 })).toBe(true);
    // No status at all means the request never landed.
    expect(isRetryable({})).toBe(true);
  });

  it("retries the timeouts and throttles that a bad link produces", () => {
    expect(isRetryable({ httpStatus: 408 })).toBe(true);
    expect(isRetryable({ httpStatus: 429 })).toBe(true);
  });

  it("does not retry a request that is simply wrong", () => {
    expect(isRetryable({ httpStatus: 400 })).toBe(false);
    expect(isRetryable({ httpStatus: 403 })).toBe(false);
    expect(isRetryable({ httpStatus: 404 })).toBe(false);
    expect(isRetryable({ httpStatus: 412 })).toBe(false);
  });
});
