import { describe, expect, it } from "vitest";
import { FlagState, LogCategory } from "@prisma/client";
import {
  bulletinSections,
  flagLogSummary,
  publishedLog,
  sortLog,
  summarizeLog,
  type LogEntryLike,
} from "@/lib/officials-log";
import { diffFields } from "@/server/services/audit";

function entry(
  id: string,
  minutes: number,
  category: LogCategory,
  published = true,
): LogEntryLike {
  return {
    id,
    occurredAt: new Date(2026, 5, 1, 12, minutes),
    category,
    summary: `${category} at ${minutes}`,
    published,
    automatic: true,
  };
}

describe("sortLog", () => {
  it("reads oldest first, the way a log is read", () => {
    const sorted = sortLog([
      entry("c", 30, LogCategory.FLAG),
      entry("a", 10, LogCategory.SESSION),
      entry("b", 20, LogCategory.NOTE),
    ]);
    expect(sorted.map((e) => e.id)).toEqual(["a", "b", "c"]);
  });

  it("breaks same-instant ties deterministically", () => {
    const first = sortLog([
      entry("z", 10, LogCategory.FLAG),
      entry("a", 10, LogCategory.NOTE),
    ]);
    const second = sortLog([
      entry("a", 10, LogCategory.NOTE),
      entry("z", 10, LogCategory.FLAG),
    ]);
    expect(first.map((e) => e.id)).toEqual(second.map((e) => e.id));
  });

  it("does not mutate its input", () => {
    const entries = [entry("b", 20, LogCategory.NOTE), entry("a", 10, LogCategory.FLAG)];
    sortLog(entries);
    expect(entries[0].id).toBe("b");
  });
});

describe("publishedLog", () => {
  it("keeps only published entries, in order", () => {
    const log = publishedLog([
      entry("c", 30, LogCategory.FLAG, true),
      entry("b", 20, LogCategory.NOTE, false),
      entry("a", 10, LogCategory.SESSION, true),
    ]);
    expect(log.map((e) => e.id)).toEqual(["a", "c"]);
  });
});

describe("bulletinSections", () => {
  it("groups by category in meeting order", () => {
    const sections = bulletinSections([
      entry("p", 40, LogCategory.PENALTY),
      entry("f", 20, LogCategory.FLAG),
      entry("s", 10, LogCategory.SESSION),
    ]);
    expect(sections.map((section) => section.category)).toEqual([
      LogCategory.SESSION,
      LogCategory.FLAG,
      LogCategory.PENALTY,
    ]);
  });

  it("drops empty categories rather than printing a bare heading", () => {
    const sections = bulletinSections([entry("s", 10, LogCategory.SESSION)]);
    expect(sections).toHaveLength(1);
  });

  it("keeps entries chronological inside each section", () => {
    const sections = bulletinSections([
      entry("b", 30, LogCategory.FLAG),
      entry("a", 10, LogCategory.FLAG),
    ]);
    expect(sections[0].entries.map((e) => e.id)).toEqual(["a", "b"]);
  });
});

describe("summarizeLog", () => {
  it("counts total, published and per category", () => {
    const summary = summarizeLog([
      entry("a", 10, LogCategory.FLAG, true),
      entry("b", 20, LogCategory.FLAG, false),
      entry("c", 30, LogCategory.PENALTY, true),
    ]);
    expect(summary.total).toBe(3);
    expect(summary.published).toBe(2);
    expect(summary.byCategory.FLAG).toBe(2);
    expect(summary.byCategory.PENALTY).toBe(1);
    expect(summary.byCategory.SESSION).toBe(0);
  });
});

describe("flagLogSummary", () => {
  it("reads as a transition", () => {
    expect(flagLogSummary("Race", FlagState.GREEN, FlagState.SAFETY_CAR)).toBe(
      "Race: green → safety car",
    );
  });
});

describe("diffFields", () => {
  it("reports only the named fields that changed", () => {
    const changes = diffFields(
      { summary: "old", timeSeconds: 10, notes: "keep" },
      { summary: "new", timeSeconds: 10 },
      ["summary", "timeSeconds", "notes"],
    );
    expect(changes).toEqual({ summary: { from: "old", to: "new" } });
  });

  it("returns null when nothing moved, so no-op audits are skipped", () => {
    expect(
      diffFields({ a: 1 }, { a: 1 }, ["a"]),
    ).toBeNull();
  });

  it("ignores fields the caller did not supply", () => {
    expect(diffFields({ a: 1, b: 2 }, { a: 1 }, ["a", "b"])).toBeNull();
  });

  it("treats null and undefined as the same absence", () => {
    expect(
      diffFields({ note: null as string | null }, { note: undefined }, ["note"]),
    ).toBeNull();
  });

  it("records a value being cleared", () => {
    expect(
      diffFields({ note: "something" as string | null }, { note: null }, [
        "note",
      ]),
    ).toEqual({ note: { from: "something", to: null } });
  });

  it("compares dates by instant, not identity", () => {
    const when = new Date("2026-06-01T12:00:00Z");
    expect(
      diffFields({ at: when }, { at: new Date(when.getTime()) }, ["at"]),
    ).toBeNull();
    expect(
      diffFields({ at: when }, { at: new Date("2026-06-02T12:00:00Z") }, ["at"]),
    ).toEqual({
      at: {
        from: "2026-06-01T12:00:00.000Z",
        to: "2026-06-02T12:00:00.000Z",
      },
    });
  });
});
