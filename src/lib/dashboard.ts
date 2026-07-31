/**
 * The signed-in home page.
 *
 * Ordered by what needs a person *now*, not by what the platform finds
 * interesting. Someone signing in on a Saturday morning wants the session
 * running right now, then the thing blocking their entry, then the race they
 * are going to. A reverse-chronological feed of everything would bury all
 * three.
 */

export type ActionUrgency = "now" | "soon" | "whenever";

export interface ActionItem {
  id: string;
  urgency: ActionUrgency;
  title: string;
  detail: string;
  href: string;
  actionLabel: string;
}

const URGENCY_ORDER: Record<ActionUrgency, number> = {
  now: 0,
  soon: 1,
  whenever: 2,
};

/**
 * Sorts by urgency, then by how soon the thing happens.
 *
 * Stable within a bucket so the list does not reshuffle between renders while
 * someone is reading it, which is disorienting on a page that polls.
 */
export function sortActions(items: ActionItem[]): ActionItem[] {
  return [...items].sort(
    (a, b) => URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency],
  );
}

export interface EntryLike {
  id: string;
  status: string;
  eventId: string;
  eventName: string;
  eventDate: Date;
  outstandingWaivers: number;
  outstandingRequirements: number;
}

/**
 * Turns a person's entries into the things blocking them.
 *
 * Only for events still to come: a waiver unsigned for a race that already
 * happened is history, not a task, and putting it in a to-do list trains
 * people to ignore the list.
 */
export function entryActions(
  entries: EntryLike[],
  now: Date = new Date(),
): ActionItem[] {
  const actions: ActionItem[] = [];
  for (const entry of entries) {
    if (entry.eventDate < now) continue;

    if (entry.outstandingWaivers > 0) {
      actions.push({
        id: `waiver-${entry.id}`,
        // Nobody else can sign it, and an unsigned waiver stops the entry
        // being confirmed at all.
        urgency: "now",
        title: `Sign ${entry.outstandingWaivers} waiver${entry.outstandingWaivers === 1 ? "" : "s"}`,
        detail: `${entry.eventName} — your entry cannot be confirmed until you do.`,
        href: `/events/${entry.eventId}`,
        actionLabel: "Read and sign",
      });
    }
    if (entry.outstandingRequirements > 0) {
      actions.push({
        id: `eligibility-${entry.id}`,
        urgency: "soon",
        title: `${entry.outstandingRequirements} entry requirement${entry.outstandingRequirements === 1 ? "" : "s"} outstanding`,
        detail: `${entry.eventName} — the organizers need these before they can confirm you.`,
        href: `/events/${entry.eventId}`,
        actionLabel: "See what is missing",
      });
    }
    if (entry.status === "PENDING") {
      actions.push({
        id: `pending-${entry.id}`,
        // Nothing for them to do; shown so they know it is not lost.
        urgency: "whenever",
        title: "Entry awaiting a decision",
        detail: `${entry.eventName} — the organizers have not decided yet.`,
        href: `/events/${entry.eventId}`,
        actionLabel: "View event",
      });
    }
  }
  return actions;
}

/** Days between two dates, rounded down, negative for the past. */
export function daysUntil(date: Date, now: Date = new Date()): number {
  const startOfDay = (value: Date) =>
    new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  return Math.round((startOfDay(date) - startOfDay(now)) / 86_400_000);
}

/** "Today", "Tomorrow", "in 4 days", "3 weeks ago". */
export function relativeDay(date: Date, now: Date = new Date()): string {
  const days = daysUntil(date, now);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  if (days > 0) {
    if (days < 7) return `in ${days} days`;
    if (days < 14) return "next week";
    if (days < 60) return `in ${plural(Math.round(days / 7), "week")}`;
    return `in ${plural(Math.round(days / 30), "month")}`;
  }
  const past = Math.abs(days);
  if (past < 7) return `${past} days ago`;
  if (past < 60) return `${plural(Math.round(past / 7), "week")} ago`;
  return `${plural(Math.round(past / 30), "month")} ago`;
}

/** "1 week" / "3 weeks" — the rounding here regularly lands on one. */
function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * A greeting that reflects the time of day.
 *
 * Small, but it is the first line someone reads and it makes the page feel
 * addressed to them rather than generated.
 */
export function greeting(name: string | null, now: Date = new Date()): string {
  const hour = now.getHours();
  const part =
    hour < 5
      ? "Still up"
      : hour < 12
        ? "Good morning"
        : hour < 18
          ? "Good afternoon"
          : "Good evening";
  return name ? `${part}, ${name.split(/\s+/)[0]}` : part;
}
