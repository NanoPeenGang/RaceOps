/**
 * What a person is told when something works, and when it does not.
 *
 * Pure and separate from the toast component so the rules can be tested
 * without a DOM — and so the two decisions that actually matter are written
 * down somewhere rather than living inside a `setTimeout`.
 */

export type ToastTone = "success" | "error" | "info";

/**
 * How long each kind of message stays.
 *
 * Errors never dismiss themselves. A message that says what went wrong and
 * then vanishes before it is read is worse than no message at all: the person
 * knows something failed and has no idea what, and their only move is to try
 * again and hope.
 */
export const DISMISS_AFTER_MS: Record<ToastTone, number | null> = {
  success: 4_000,
  info: 6_000,
  error: null,
};

export function dismissesItself(tone: ToastTone): boolean {
  return DISMISS_AFTER_MS[tone] !== null;
}

/** At most this many at once; older ones drop rather than stacking off-screen. */
export const MAX_VISIBLE_TOASTS = 3;

/**
 * The sentence to show for a failure.
 *
 * tRPC surfaces input validation as a JSON array of Zod issues — accurate,
 * and unreadable. Putting a stack of field paths in front of somebody is
 * worse than the silence this replaced, so anything shaped like one falls back
 * to a plain sentence pointing at the form.
 */
export function describeFailure(error: unknown): string {
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const trimmed = message.trim();
  if (!trimmed) return "That did not go through. Try again.";
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    return "Something in that form was not right — check the fields and try again.";
  }
  return trimmed;
}

/**
 * Keeps the newest messages and drops the rest.
 *
 * Newest rather than oldest, because the last thing somebody did is the thing
 * they are waiting on. A queue that kept the first three would leave a person
 * watching a stale confirmation while the action they just took said nothing.
 */
export function trimToasts<T>(
  current: readonly T[],
  incoming: T,
  max = MAX_VISIBLE_TOASTS,
): T[] {
  return [...current, incoming].slice(-max);
}
