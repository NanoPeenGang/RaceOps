import { describe, expect, it } from "vitest";
import {
  ATTENTION_TAB,
  EMPTY_ATTENTION,
  attentionCount,
  attentionItems,
  needsAttention,
  sortByAttention,
  tabBadge,
} from "@/lib/attention";
import type { TeamAttention } from "@/lib/attention";

const team = (over: Partial<TeamAttention> = {}): TeamAttention => ({
  ...EMPTY_ATTENTION,
  teamId: "t1",
  teamName: "Apex Racing",
  teamSlug: "apex-racing",
  ...over,
});

describe("attentionItems", () => {
  it("is empty when nothing is outstanding", () => {
    // A list of things that are fine is not a to-do list, and reading one
    // teaches people to skip the whole strip.
    expect(attentionItems(team())).toEqual([]);
    expect(needsAttention(team())).toBe(false);
  });

  it("drops the zeros and keeps the rest", () => {
    const items = attentionItems(team({ newApplications: 3 }));
    expect(items).toHaveLength(1);
    expect(items[0]!.key).toBe("newApplications");
    expect(items[0]!.count).toBe(3);
  });

  it("puts what is already wrong ahead of what is merely due", () => {
    const items = attentionItems(
      team({ newApplications: 5, overdueServices: 1 }),
    );
    expect(items.map((item) => item.key)).toEqual([
      "overdueServices",
      "newApplications",
    ]);
    expect(items[0]!.tone).toBe("urgent");
    expect(items[1]!.tone).toBe("due");
  });

  it("reserves urgent for money owed, cars overdue and people kept waiting", () => {
    // Marking everything urgent is the same as marking nothing.
    const urgent = attentionItems(
      team({
        payRunsToPay: 1,
        overdueServices: 1,
        staleApplications: 1,
        newApplications: 1,
        interviewsToArrange: 1,
        payRunsToApprove: 1,
        lowStock: 1,
      }),
    ).filter((item) => item.tone === "urgent");

    expect(urgent.map((item) => item.key).sort()).toEqual([
      "overdueServices",
      "payRunsToPay",
      "staleApplications",
    ]);
  });

  it("writes labels that read as sentence fragments, singular and plural", () => {
    expect(attentionItems(team({ newApplications: 1 }))[0]!.label).toBe(
      "1 new application",
    );
    expect(attentionItems(team({ newApplications: 2 }))[0]!.label).toBe(
      "2 new applications",
    );
    expect(attentionItems(team({ payRunsToPay: 1 }))[0]!.label).toBe(
      "1 pay run part-paid",
    );
  });

  it("links into the tab that fixes it, not the top of the console", () => {
    const items = attentionItems(team({ overdueServices: 2, lowStock: 1 }));
    for (const item of items) {
      expect(item.href).toContain("/teams/apex-racing/manage?tab=");
    }
    expect(
      items.find((item) => item.key === "overdueServices")!.href,
    ).toContain("tab=garage");
  });

  it("counts things to do, not the sum of the counts", () => {
    // Twelve low-stock parts is one trip to the shop.
    expect(attentionCount(team({ lowStock: 12 }))).toBe(1);
    expect(attentionCount(team({ lowStock: 12, newApplications: 4 }))).toBe(2);
  });
});

describe("ATTENTION_TAB", () => {
  it("routes every count to a tab", () => {
    // A count with no home would render a badge nobody could act on.
    const counted = Object.keys(EMPTY_ATTENTION).sort();
    expect(Object.keys(ATTENTION_TAB).sort()).toEqual(counted);
  });
});

describe("tabBadge", () => {
  it("sums everything routed to one tab", () => {
    const attention = team({
      newApplications: 2,
      staleApplications: 1,
      interviewsToArrange: 3,
      overdueServices: 4,
    });
    expect(tabBadge(attention, "hiring")).toBe(6);
    expect(tabBadge(attention, "garage")).toBe(4);
  });

  it("is null rather than zero, so the tab hides it", () => {
    // A grey "0" beside every tab is exactly the noise this cuts through.
    expect(tabBadge(team(), "hiring")).toBeNull();
    expect(tabBadge(team({ newApplications: 1 }), "money")).toBeNull();
  });

  it("is null when the viewer has no attention at all", () => {
    // Which is how a driver opening the console gets no badges rather than
    // zeros — they are not told what they cannot see.
    expect(tabBadge(null, "hiring")).toBeNull();
    expect(tabBadge(undefined, "garage")).toBeNull();
  });
});

describe("sortByAttention", () => {
  it("drops teams with nothing outstanding", () => {
    const sorted = sortByAttention([
      team({ teamId: "quiet" }),
      team({ teamId: "busy", newApplications: 1 }),
    ]);
    expect(sorted.map((row) => row.teamId)).toEqual(["busy"]);
  });

  it("puts the team with the most urgent problems first", () => {
    const sorted = sortByAttention([
      team({ teamId: "a", newApplications: 9, lowStock: 4 }),
      team({ teamId: "b", overdueServices: 1 }),
    ]);
    // Nine unread applications is a busy week; an overdue rebuild is a car
    // that should not be loaded.
    expect(sorted[0]!.teamId).toBe("b");
  });

  it("breaks a tie on how many separate things there are", () => {
    const sorted = sortByAttention([
      team({ teamId: "a", overdueServices: 1 }),
      team({ teamId: "b", overdueServices: 1, newApplications: 1, lowStock: 2 }),
    ]);
    expect(sorted[0]!.teamId).toBe("b");
  });

  it("is empty for no teams", () => {
    expect(sortByAttention([])).toEqual([]);
  });
});
