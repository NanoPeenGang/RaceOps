/**
 * Direct messages: a conversation between people, belonging to no team,
 * series or event.
 *
 * This is the one room on the platform with no organizational scope, which is
 * exactly why it is wanted — an engineer wanting a word with a driver on
 * another team has nowhere else to have it. Everything here is pure so the
 * inbox, the router and the tests agree on who is in a thread and what is
 * unread.
 */

/**
 * The key that makes "message this person" idempotent.
 *
 * Two user ids sorted and joined. Sorted because the pair is unordered — a
 * thread between A and B is the same thread whichever of them opened it — and
 * without a canonical form you get two threads side by side, each holding half
 * the conversation.
 *
 * Null for anything that is not exactly two people: three colleagues can
 * reasonably want two different group threads, so grouping them by membership
 * would merge conversations that were meant to be separate.
 */
export function pairKeyFor(userIds: readonly string[]): string | null {
  const unique = [...new Set(userIds)];
  if (unique.length !== 2) return null;
  return unique.sort().join(":");
}

export interface ParticipantRecord {
  userId: string;
  readAt?: Date | string | null;
  leftAt?: Date | string | null;
}

export interface ThreadMessage {
  userId: string;
  createdAt: Date | string;
}

/**
 * Unread messages for one person in one thread.
 *
 * Your own messages never count — you wrote them. A participant who has never
 * opened the thread has everything unread, which is what makes a brand-new
 * conversation announce itself.
 */
export function unreadCount(
  messages: readonly ThreadMessage[],
  participant: ParticipantRecord,
): number {
  const readAt = participant.readAt ? new Date(participant.readAt) : null;
  return messages.filter((message) => {
    if (message.userId === participant.userId) return false;
    if (!readAt) return true;
    return new Date(message.createdAt).getTime() > readAt.getTime();
  }).length;
}

/**
 * Whether a thread should appear in somebody's inbox.
 *
 * Leaving hides it. A later message from the other side brings it back,
 * because a reply to a conversation you left is still addressed to you —
 * silently swallowing it would be the platform deciding somebody's message
 * did not deserve delivery.
 */
export function isVisibleTo(
  participant: ParticipantRecord,
  lastMessageAt: Date | string | null | undefined,
): boolean {
  if (!participant.leftAt) return true;
  if (!lastMessageAt) return false;
  return (
    new Date(lastMessageAt).getTime() > new Date(participant.leftAt).getTime()
  );
}

export interface ThreadSummary {
  subject?: string | null;
  participants: readonly { userId: string; displayName?: string | null }[];
}

/**
 * What to call a thread in a list.
 *
 * A named group keeps its name. Everything else is named after who is in it,
 * minus you — "Direct message" tells you nothing, and your own name in the
 * title of your own conversation is noise. A thread with nobody else left is
 * described as such rather than rendered blank.
 */
export function threadTitle(
  thread: ThreadSummary,
  viewerUserId: string,
  fallback = "Unnamed",
): string {
  if (thread.subject?.trim()) return thread.subject.trim();

  const others = thread.participants.filter(
    (participant) => participant.userId !== viewerUserId,
  );
  if (others.length === 0) return "Just you";

  const names = others.map((participant) => participant.displayName ?? fallback);
  if (names.length <= 3) {
    if (names.length === 1) return names[0]!;
    return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  }
  return `${names.slice(0, 2).join(", ")} and ${names.length - 2} others`;
}

/**
 * "2m", "4h", "Tue", "12 Mar" — a timestamp for an inbox row.
 *
 * Coarse on purpose. An inbox is scanned, not read: the useful distinction is
 * "just now" versus "yesterday" versus "a while ago", and a full date on every
 * row makes all three look the same.
 */
export function relativeTime(
  when: Date | string | null | undefined,
  now: Date = new Date(),
): string {
  if (!when) return "";
  const then = new Date(when);
  if (Number.isNaN(then.getTime())) return "";

  const seconds = (now.getTime() - then.getTime()) / 1000;
  if (seconds < 60) return "now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 7 * 86_400) {
    return then.toLocaleDateString(undefined, { weekday: "short" });
  }
  return then.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** Threads with unread messages first, then most recently active. */
export function sortInbox<
  T extends { unread: number; lastMessageAt?: Date | string | null },
>(threads: readonly T[]): T[] {
  return [...threads].sort((a, b) => {
    if ((a.unread > 0) !== (b.unread > 0)) return a.unread > 0 ? -1 : 1;
    const aTime = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
    const bTime = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
    return bTime - aTime;
  });
}
