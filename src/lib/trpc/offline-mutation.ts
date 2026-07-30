"use client";

import { useCallback } from "react";
import { useOffline } from "@/components/offline-provider";
import { isQueueable, type QueueableProcedure } from "@/lib/offline-queue";

/**
 * Wraps a mutation so it goes to the outbox when there is no signal.
 *
 * The pattern deliberately keeps the normal path untouched: a call goes
 * straight to the server when online, and only falls into the queue when the
 * browser says it is offline. Failing over on *error* instead would queue
 * genuine rejections — a duplicate car number, a permission failure — and
 * replay them pointlessly for the rest of the meeting.
 */

export interface OfflineMutationOptions<TInput> {
  procedure: QueueableProcedure;
  /// Shown in the outbox so a person can see what is waiting.
  label: (input: TInput) => string;
  /**
   * Optional logical identity. Two queued writes with the same key are the
   * same action and the later replaces the earlier — a scrutineer correcting
   * a measurement three times offline should send one result, not three.
   */
  dedupeKey?: (input: TInput) => string;
}

export interface OfflineCapableMutation<TInput> {
  /// Sends now, or queues when offline. Returns whether it was queued.
  run: (input: TInput) => Promise<{ queued: boolean }>;
}

export function useOfflineMutation<TInput>(
  mutate: (input: TInput) => Promise<unknown>,
  options: OfflineMutationOptions<TInput>,
): OfflineCapableMutation<TInput> {
  const { online, queueMutation } = useOffline();

  const run = useCallback(
    async (input: TInput) => {
      if (online) {
        await mutate(input);
        return { queued: false };
      }
      if (!isQueueable(options.procedure)) {
        // Should be unreachable — the type narrows it — but a mutation that
        // silently vanishes offline is the worst possible outcome, so this
        // fails loudly instead.
        throw new Error(
          `${options.procedure} cannot be queued; it must be sent online.`,
        );
      }
      queueMutation({
        id: crypto.randomUUID(),
        procedure: options.procedure,
        input,
        label: options.label(input),
        dedupeKey: options.dedupeKey?.(input),
      });
      return { queued: true };
    },
    [online, mutate, options, queueMutation],
  );

  return { run };
}
