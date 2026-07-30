import { AuditAction, FlagState, LogCategory } from "@prisma/client";

/**
 * The officials' event log.
 *
 * Race control already produces every one of these events — a flag change, a
 * penalty, a car referred to scrutineering — but nobody can read them in
 * order, and reading them in order is what an end-of-meeting bulletin is.
 */

export const LOG_CATEGORY_LABELS: Record<LogCategory, string> = {
  SESSION: "Session",
  FLAG: "Flags",
  INCIDENT: "Incidents",
  PENALTY: "Penalties",
  TECHNICAL: "Technical",
  DOCUMENT: "Documents",
  NOTE: "Notes",
};

export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  CREATE: "Created",
  UPDATE: "Edited",
  DELETE: "Deleted",
  STATUS_CHANGE: "Status changed",
  PUBLISH: "Published",
};

/** Order the bulletin groups categories in — the order a meeting runs. */
export const LOG_CATEGORY_ORDER: LogCategory[] = [
  LogCategory.SESSION,
  LogCategory.FLAG,
  LogCategory.TECHNICAL,
  LogCategory.INCIDENT,
  LogCategory.PENALTY,
  LogCategory.DOCUMENT,
  LogCategory.NOTE,
];

export interface LogEntryLike {
  id: string;
  occurredAt: Date;
  category: LogCategory;
  summary: string;
  detail?: string | null;
  published: boolean;
  automatic: boolean;
  sessionId?: string | null;
}

/**
 * Chronological order, oldest first — the way a log is read.
 *
 * Ties break on id so two entries written in the same millisecond (a flag
 * change and the note about it) always come out in the same order rather than
 * shuffling between renders.
 */
export function sortLog<T extends LogEntryLike>(entries: T[]): T[] {
  return [...entries].sort((a, b) => {
    const byTime = a.occurredAt.getTime() - b.occurredAt.getTime();
    return byTime !== 0 ? byTime : a.id.localeCompare(b.id);
  });
}

/**
 * The published subset, which is the bulletin.
 * Unpublished entries are race control's working notes and stay internal.
 */
export function publishedLog<T extends LogEntryLike>(entries: T[]): T[] {
  return sortLog(entries.filter((entry) => entry.published));
}

export interface LogSection {
  category: LogCategory;
  label: string;
  entries: LogEntryLike[];
}

/**
 * The bulletin grouped by category, in meeting order.
 * Empty categories are dropped: a meeting with no penalties should not
 * publish a "Penalties" heading with nothing under it.
 */
export function bulletinSections<T extends LogEntryLike>(
  entries: T[],
): { category: LogCategory; label: string; entries: T[] }[] {
  const sorted = sortLog(entries);
  return LOG_CATEGORY_ORDER.map((category) => ({
    category,
    label: LOG_CATEGORY_LABELS[category],
    entries: sorted.filter((entry) => entry.category === category),
  })).filter((section) => section.entries.length > 0);
}

export interface LogSummary {
  total: number;
  published: number;
  byCategory: Record<LogCategory, number>;
}

export function summarizeLog(entries: LogEntryLike[]): LogSummary {
  const byCategory = Object.fromEntries(
    LOG_CATEGORY_ORDER.map((category) => [category, 0]),
  ) as Record<LogCategory, number>;
  let published = 0;
  for (const entry of entries) {
    byCategory[entry.category] += 1;
    if (entry.published) published += 1;
  }
  return { total: entries.length, published, byCategory };
}

/** Log line for a flag change, so the wording is the same everywhere. */
export function flagLogSummary(
  sessionName: string,
  from: FlagState,
  to: FlagState,
): string {
  return `${sessionName}: ${FLAG_WORDS[from]} → ${FLAG_WORDS[to]}`;
}

const FLAG_WORDS: Record<FlagState, string> = {
  NONE: "no flag",
  GREEN: "green",
  YELLOW: "yellow",
  SAFETY_CAR: "safety car",
  VIRTUAL_SAFETY_CAR: "virtual safety car",
  RED: "red",
  CHECKERED: "checkered",
};

/** "14:32:07" — the format a log is read in, seconds included. */
export function logTime(at: Date): string {
  return at.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
