"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { TRPCClientError } from "@trpc/client";
import { api } from "@/lib/trpc/client";
import {
  dueItems,
  enqueue,
  isRetryable,
  markDelivered,
  markFailed,
  markSending,
  parkedItems,
  summarizeQueue,
  type EnqueueInput,
  type QueueSummary,
  type QueuedMutation,
} from "@/lib/offline-queue";
import { loadQueue, saveQueue } from "@/lib/offline-store";

/**
 * Trackside mode: queue writes when there is no signal, send them when there
 * is.
 *
 * Marshal posts and scrutineering bays have terrible connectivity. Without
 * this, everything is written on paper and typed in later from notes — which
 * is the difference between a system used at the track and one used after it.
 *
 * Deliberately not a general-purpose retry layer. Only the mutations on the
 * allowlist can be queued (see `offline-queue`), and everything else still
 * fails loudly offline, because the person needs to know it did not happen.
 */

interface OfflineContextValue {
  online: boolean;
  queue: QueuedMutation[];
  summary: QueueSummary;
  /// Queues a mutation. Returns immediately; delivery happens in the loop.
  queueMutation: (input: Omit<EnqueueInput, "now">) => void;
  /// Try everything that is due right now.
  flush: () => void;
  /// Throw away items that have given up, after the person has dealt with them.
  discardParked: () => void;
}

const OfflineContext = createContext<OfflineContextValue | null>(null);

/** How often the replay loop wakes up while there is anything queued. */
const TICK_MS = 5_000;

export function OfflineProvider({ children }: { children: React.ReactNode }) {
  const [online, setOnline] = useState(true);
  const [queue, setQueue] = useState<QueuedMutation[]>([]);
  const utils = api.useUtils();
  // The replay loop reads the queue through a ref so the interval does not
  // have to be torn down and rebuilt on every queue change.
  const queueRef = useRef<QueuedMutation[]>([]);
  const flushing = useRef(false);

  const update = useCallback(
    (next: QueuedMutation[] | ((current: QueuedMutation[]) => QueuedMutation[])) => {
      setQueue((current) => {
        const resolved = typeof next === "function" ? next(current) : next;
        queueRef.current = resolved;
        void saveQueue(resolved);
        return resolved;
      });
    },
    [],
  );

  // Restore anything left over from a previous session — the queue's whole
  // value is surviving a page nobody kept open.
  useEffect(() => {
    let cancelled = false;
    void loadQueue().then((stored) => {
      if (cancelled || stored.length === 0) return;
      queueRef.current = stored;
      setQueue(stored);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setOnline(navigator.onLine);
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  const flush = useCallback(async () => {
    if (flushing.current) return;
    const due = dueItems(queueRef.current);
    if (due.length === 0) return;

    flushing.current = true;
    try {
      // Sent one at a time, in the order things actually happened: two flag
      // notes must reach race control in the order the marshal made them.
      for (const item of due) {
        update((current) => markSending(current, item.id));
        try {
          await callProcedure(utils, item);
          update((current) => markDelivered(current, item.id));
        } catch (error) {
          const retryable =
            error instanceof TRPCClientError
              ? isRetryable({
                  httpStatus: error.data?.httpStatus as number | undefined,
                  code: error.data?.code as string | undefined,
                })
              : true;
          update((current) =>
            markFailed(
              current,
              item.id,
              error instanceof Error ? error.message : "Could not send",
              { permanent: !retryable },
            ),
          );
          // A network failure means the rest will fail too; stop rather than
          // burning an attempt on every queued item at once.
          if (retryable) break;
        }
      }
    } finally {
      flushing.current = false;
    }
  }, [update, utils]);

  // Try immediately when connectivity returns, then on a slow tick.
  useEffect(() => {
    if (!online) return;
    void flush();
    const timer = setInterval(() => void flush(), TICK_MS);
    return () => clearInterval(timer);
  }, [online, flush]);

  const queueMutation = useCallback(
    (input: Omit<EnqueueInput, "now">) => {
      update((current) => enqueue(current, input));
    },
    [update],
  );

  const discardParked = useCallback(() => {
    update((current) => {
      const parked = new Set(parkedItems(current).map((item) => item.id));
      return current.filter((item) => !parked.has(item.id));
    });
  }, [update]);

  const value = useMemo<OfflineContextValue>(
    () => ({
      online,
      queue,
      summary: summarizeQueue(queue),
      queueMutation,
      flush: () => void flush(),
      discardParked,
    }),
    [online, queue, queueMutation, flush, discardParked],
  );

  return (
    <OfflineContext.Provider value={value}>{children}</OfflineContext.Provider>
  );
}

export function useOffline(): OfflineContextValue {
  const context = useContext(OfflineContext);
  if (!context) {
    throw new Error("useOffline must be used inside OfflineProvider");
  }
  return context;
}

/**
 * Sends one queued mutation.
 *
 * The tRPC utils proxy is walked by path rather than switching on the string,
 * so adding a procedure to the allowlist does not also mean editing this.
 */
async function callProcedure(
  utils: ReturnType<typeof api.useUtils>,
  item: QueuedMutation,
): Promise<unknown> {
  const [router, procedure] = item.procedure.split(".");
  const client = (
    utils as unknown as {
      client: Record<string, Record<string, { mutate: (input: unknown) => Promise<unknown> }>>;
    }
  ).client;
  const target = client?.[router]?.[procedure];
  if (!target?.mutate) {
    throw new Error(`${item.procedure} cannot be sent from the outbox`);
  }
  return target.mutate(item.input);
}
