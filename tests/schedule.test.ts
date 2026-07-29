import { describe, expect, it } from "vitest";
import { SessionType } from "@prisma/client";
import {
  dayKeyOf,
  findScheduleClashes,
  groupSessionsByDay,
  scheduleSpan,
  sessionsOverlap,
} from "@/lib/schedule";

/** Builds a session on a given local day at hh:mm, lasting `minutes`. */
function session(
  id: string,
  day: number,
  hour: number,
  minutes = 60,
  type: SessionType = SessionType.PRACTICE,
) {
  const startsAt = new Date(2026, 5, day, hour, 0, 0, 0);
  const endsAt = new Date(startsAt.getTime() + minutes * 60_000);
  return { id, name: id, type, startsAt, endsAt };
}

describe("dayKeyOf", () => {
  it("uses the local calendar day, not UTC", () => {
    // 23:30 local is a different UTC day in most timezones; the running order
    // must still file it under the local day the paddock is living in.
    const late = new Date(2026, 5, 12, 23, 30);
    expect(dayKeyOf(late)).toBe("2026-06-12");
  });

  it("zero-pads month and day", () => {
    expect(dayKeyOf(new Date(2026, 0, 3, 9, 0))).toBe("2026-01-03");
  });
});

describe("groupSessionsByDay", () => {
  it("groups a three-day meeting in day then time order", () => {
    const sessions = [
      session("sunday-race", 14, 14),
      session("friday-scrutineering", 12, 9),
      session("saturday-quali", 13, 15),
      session("saturday-practice", 13, 10),
    ];

    const days = groupSessionsByDay(sessions);

    expect(days.map((d) => d.dayKey)).toEqual([
      "2026-06-12",
      "2026-06-13",
      "2026-06-14",
    ]);
    expect(days[1].sessions.map((s) => s.id)).toEqual([
      "saturday-practice",
      "saturday-quali",
    ]);
  });

  it("returns no days for an empty schedule", () => {
    expect(groupSessionsByDay([])).toEqual([]);
  });

  it("anchors each day's date at local midnight", () => {
    const [day] = groupSessionsByDay([session("fp1", 12, 14)]);
    expect(day.date.getHours()).toBe(0);
    expect(day.date.getDate()).toBe(12);
  });
});

describe("sessionsOverlap", () => {
  it("detects a genuine overlap", () => {
    expect(sessionsOverlap(session("a", 12, 10, 90), session("b", 12, 11))).toBe(
      true,
    );
  });

  it("treats touching endpoints as no overlap", () => {
    // A session ending at 11:00 and the next starting at 11:00 is a normal
    // back-to-back running order, not a clash.
    expect(sessionsOverlap(session("a", 12, 10, 60), session("b", 12, 11))).toBe(
      false,
    );
  });

  it("does not overlap across different days", () => {
    expect(sessionsOverlap(session("a", 12, 10), session("b", 13, 10))).toBe(
      false,
    );
  });
});

describe("findScheduleClashes", () => {
  it("reports each clashing pair once", () => {
    const clashes = findScheduleClashes([
      session("fp1", 12, 10, 120),
      session("briefing", 12, 11, 30),
      session("support", 12, 15),
    ]);
    expect(clashes).toHaveLength(1);
    expect(clashes[0].map((s) => s.id).sort()).toEqual(["briefing", "fp1"]);
  });

  it("finds clashes for a session overlapping two others", () => {
    const clashes = findScheduleClashes([
      session("long", 12, 9, 240),
      session("a", 12, 10, 30),
      session("b", 12, 12, 30),
    ]);
    expect(clashes).toHaveLength(2);
  });

  it("returns nothing for a clean back-to-back schedule", () => {
    expect(
      findScheduleClashes([
        session("fp1", 12, 9),
        session("fp2", 12, 10),
        session("quali", 12, 11),
      ]),
    ).toEqual([]);
  });
});

describe("scheduleSpan", () => {
  it("spans the earliest start to the latest end and counts days", () => {
    const span = scheduleSpan([
      session("saturday", 13, 10),
      session("friday", 12, 9),
      session("sunday", 14, 14, 180),
    ]);
    expect(span).not.toBeNull();
    expect(span!.days).toBe(3);
    expect(span!.start).toEqual(new Date(2026, 5, 12, 9));
    expect(span!.end).toEqual(new Date(2026, 5, 14, 17));
  });

  it("counts one day for several sessions on the same day", () => {
    expect(
      scheduleSpan([session("a", 12, 9), session("b", 12, 16)])!.days,
    ).toBe(1);
  });

  it("is null with no sessions", () => {
    expect(scheduleSpan([])).toBeNull();
  });
});
