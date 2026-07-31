import { describe, expect, it } from "vitest";
import {
  daysUntil,
  entryActions,
  greeting,
  relativeDay,
  sortActions,
  type ActionItem,
  type EntryLike,
} from "@/lib/dashboard";
import { initialsOf } from "@/components/ui/avatar";

const NOW = new Date(2026, 5, 1, 10, 0);

function entry(overrides: Partial<EntryLike> = {}): EntryLike {
  return {
    id: "e1",
    status: "CONFIRMED",
    eventId: "evt1",
    eventName: "Round 1",
    eventDate: new Date(2026, 5, 8),
    outstandingWaivers: 0,
    outstandingRequirements: 0,
    ...overrides,
  };
}

describe("entryActions", () => {
  it("puts an unsigned waiver at the top, because only they can sign it", () => {
    const actions = entryActions([entry({ outstandingWaivers: 2 })], NOW);
    expect(actions[0].urgency).toBe("now");
    expect(actions[0].title).toContain("2 waivers");
  });

  it("uses the singular for one", () => {
    const actions = entryActions([entry({ outstandingWaivers: 1 })], NOW);
    expect(actions[0].title).toBe("Sign 1 waiver");
  });

  it("raises outstanding requirements, less urgently", () => {
    const actions = entryActions([entry({ outstandingRequirements: 3 })], NOW);
    expect(actions[0].urgency).toBe("soon");
    expect(actions[0].title).toContain("3 entry requirements");
  });

  it("mentions a pending entry so it does not look lost", () => {
    const actions = entryActions([entry({ status: "PENDING" })], NOW);
    expect(actions[0].urgency).toBe("whenever");
  });

  it("ignores events that have already happened", () => {
    // A waiver unsigned for last month's race is history, not a task —
    // putting it in a to-do list trains people to ignore the list.
    const actions = entryActions(
      [entry({ eventDate: new Date(2026, 4, 1), outstandingWaivers: 2 })],
      NOW,
    );
    expect(actions).toEqual([]);
  });

  it("says nothing for an entry with nothing outstanding", () => {
    expect(entryActions([entry()], NOW)).toEqual([]);
  });

  it("raises every blocker on one entry", () => {
    const actions = entryActions(
      [entry({ outstandingWaivers: 1, outstandingRequirements: 1 })],
      NOW,
    );
    expect(actions).toHaveLength(2);
  });
});

describe("sortActions", () => {
  const make = (id: string, urgency: ActionItem["urgency"]): ActionItem => ({
    id,
    urgency,
    title: id,
    detail: "",
    href: "/",
    actionLabel: "Go",
  });

  it("orders now before soon before whenever", () => {
    const sorted = sortActions([
      make("c", "whenever"),
      make("a", "now"),
      make("b", "soon"),
    ]);
    expect(sorted.map((item) => item.id)).toEqual(["a", "b", "c"]);
  });

  it("is stable within a bucket, so a polling page does not reshuffle", () => {
    const items = [make("x", "now"), make("y", "now"), make("z", "now")];
    expect(sortActions(items).map((i) => i.id)).toEqual(["x", "y", "z"]);
  });

  it("does not mutate its input", () => {
    const items = [make("b", "whenever"), make("a", "now")];
    sortActions(items);
    expect(items[0].id).toBe("b");
  });
});

describe("daysUntil", () => {
  it("counts calendar days, not elapsed hours", () => {
    // 23:00 tonight to 01:00 tomorrow is one day, not zero.
    expect(daysUntil(new Date(2026, 5, 2, 1, 0), new Date(2026, 5, 1, 23, 0))).toBe(
      1,
    );
  });

  it("is zero for later today", () => {
    expect(daysUntil(new Date(2026, 5, 1, 23, 0), NOW)).toBe(0);
  });

  it("goes negative for the past", () => {
    expect(daysUntil(new Date(2026, 4, 29), NOW)).toBe(-3);
  });
});

describe("relativeDay", () => {
  it("uses words for the near future", () => {
    expect(relativeDay(new Date(2026, 5, 1, 18), NOW)).toBe("Today");
    expect(relativeDay(new Date(2026, 5, 2), NOW)).toBe("Tomorrow");
    expect(relativeDay(new Date(2026, 5, 4), NOW)).toBe("in 3 days");
  });

  it("coarsens as it gets further away", () => {
    expect(relativeDay(new Date(2026, 5, 22), NOW)).toBe("in 3 weeks");
    expect(relativeDay(new Date(2026, 8, 1), NOW)).toBe("in 3 months");
  });

  it("reads naturally for the past", () => {
    expect(relativeDay(new Date(2026, 4, 31), NOW)).toBe("Yesterday");
    expect(relativeDay(new Date(2026, 4, 25), NOW)).toBe("1 week ago");
    expect(relativeDay(new Date(2026, 4, 11), NOW)).toBe("3 weeks ago");
  });
});

describe("greeting", () => {
  it("matches the time of day", () => {
    expect(greeting("Sam", new Date(2026, 5, 1, 9))).toBe("Good morning, Sam");
    expect(greeting("Sam", new Date(2026, 5, 1, 14))).toBe(
      "Good afternoon, Sam",
    );
    expect(greeting("Sam", new Date(2026, 5, 1, 21))).toBe("Good evening, Sam");
    expect(greeting("Sam", new Date(2026, 5, 1, 3))).toBe("Still up, Sam");
  });

  it("uses the first name only", () => {
    expect(greeting("Roberta Smith-Okonkwo", new Date(2026, 5, 1, 9))).toBe(
      "Good morning, Roberta",
    );
  });

  it("works before someone has a name", () => {
    expect(greeting(null, new Date(2026, 5, 1, 9))).toBe("Good morning");
  });
});

describe("initialsOf", () => {
  it("takes the first and last word, which is what people recognise", () => {
    expect(initialsOf("Jean-Luc van der Berg")).toBe("JB");
    expect(initialsOf("Sam Driver")).toBe("SD");
  });

  it("copes with one word and with none", () => {
    expect(initialsOf("Sam")).toBe("SA");
    expect(initialsOf("")).toBe("?");
    expect(initialsOf("   ")).toBe("?");
  });
});
