import { describe, expect, it } from "vitest";
import { InterviewKind, InterviewStatus } from "@prisma/client";
import {
  INTERVIEW_KIND_DESCRIPTIONS,
  INTERVIEW_KIND_LABELS,
  INTERVIEW_STATUS_LABELS,
  LOCATION_PLACEHOLDERS,
  MAX_SLOTS,
  checkSlots,
  chosenSlot,
  formatDuration,
  formatSlot,
  hasPassed,
  nextBooked,
  sortSlots,
  waitingOn,
} from "@/lib/interviews";

const NOW = new Date("2026-06-10T12:00:00Z");
const inHours = (hours: number) =>
  new Date(NOW.getTime() + hours * 3_600_000);

describe("interview vocabulary", () => {
  it("labels, describes and gives a placeholder for every kind", () => {
    for (const kind of Object.values(InterviewKind)) {
      expect(INTERVIEW_KIND_LABELS[kind], kind).toBeTruthy();
      expect(INTERVIEW_KIND_DESCRIPTIONS[kind], kind).toBeTruthy();
      expect(LOCATION_PLACEHOLDERS[kind], kind).toBeTruthy();
    }
    for (const status of Object.values(InterviewStatus)) {
      expect(INTERVIEW_STATUS_LABELS[status], status).toBeTruthy();
    }
  });
});

describe("checkSlots", () => {
  it("accepts a handful of future times", () => {
    expect(
      checkSlots([inHours(24), inHours(48), inHours(72)], NOW),
    ).toBeNull();
  });

  it("refuses none, because there would be nothing to accept", () => {
    expect(checkSlots([], NOW)?.reason).toBe("none");
  });

  it("refuses a time that has already passed", () => {
    // A team fills the form on Monday for "Friday" and sends it the following
    // week. This is the one that actually happens.
    expect(checkSlots([inHours(-1)], NOW)?.reason).toBe("past");
  });

  it("refuses two of the same time", () => {
    expect(checkSlots([inHours(24), inHours(24)], NOW)?.reason).toBe(
      "duplicate",
    );
  });

  it("refuses a diary dump", () => {
    const many = Array.from({ length: MAX_SLOTS + 1 }, (_, index) =>
      inHours(24 + index),
    );
    expect(checkSlots(many, NOW)?.reason).toBe("too-many");
  });

  it("refuses something that is not a date", () => {
    expect(checkSlots(["not a date"], NOW)?.reason).toBe("past");
  });
});

describe("sortSlots and chosenSlot", () => {
  it("puts the soonest first", () => {
    const sorted = sortSlots([
      { startsAt: inHours(72) },
      { startsAt: inHours(24) },
    ]);
    expect(new Date(sorted[0]!.startsAt).getTime()).toBe(
      inHours(24).getTime(),
    );
  });

  it("finds the picked slot, and null when none is", () => {
    expect(
      chosenSlot([{ startsAt: inHours(24) }, { startsAt: inHours(48), chosen: true }])
        ?.startsAt,
    ).toEqual(inHours(48));
    expect(chosenSlot([{ startsAt: inHours(24) }])).toBeNull();
  });
});

describe("waitingOn", () => {
  it("is the applicant while times are proposed", () => {
    expect(waitingOn({ status: InterviewStatus.PROPOSED }, NOW)).toBe(
      "applicant",
    );
  });

  it("is the team once they could not make any", () => {
    expect(waitingOn({ status: InterviewStatus.DECLINED }, NOW)).toBe("team");
  });

  it("is nobody while a booked interview is still ahead", () => {
    expect(
      waitingOn(
        {
          status: InterviewStatus.CONFIRMED,
          scheduledAt: inHours(24),
          durationMinutes: 30,
        },
        NOW,
      ),
    ).toBe("nobody");
  });

  it("is the team once a booked interview has been and gone", () => {
    // Otherwise it sits in the pipeline forever looking like a plan.
    expect(
      waitingOn(
        {
          status: InterviewStatus.CONFIRMED,
          scheduledAt: inHours(-2),
          durationMinutes: 30,
        },
        NOW,
      ),
    ).toBe("team");
  });

  it("is nobody once it is done or canceled", () => {
    expect(waitingOn({ status: InterviewStatus.COMPLETED }, NOW)).toBe("nobody");
    expect(waitingOn({ status: InterviewStatus.CANCELED }, NOW)).toBe("nobody");
  });
});

describe("hasPassed", () => {
  it("counts the duration, not just the start", () => {
    // An interview that started 20 minutes ago and runs 30 is still going.
    const running = {
      status: InterviewStatus.CONFIRMED,
      scheduledAt: new Date(NOW.getTime() - 20 * 60_000),
      durationMinutes: 30,
    };
    expect(hasPassed(running, NOW)).toBe(false);
  });

  it("is false for an interview with no time", () => {
    expect(hasPassed({ status: InterviewStatus.PROPOSED }, NOW)).toBe(false);
  });
});

describe("nextBooked", () => {
  it("is the soonest confirmed interview still ahead", () => {
    const next = nextBooked(
      [
        {
          status: InterviewStatus.CONFIRMED,
          scheduledAt: inHours(72),
        },
        {
          status: InterviewStatus.CONFIRMED,
          scheduledAt: inHours(24),
        },
      ],
      NOW,
    );
    expect(next?.scheduledAt).toEqual(inHours(24));
  });

  it("ignores proposed interviews", () => {
    // A proposed time is not in the diary, and putting it there would have
    // people preparing for a call nobody has agreed to.
    expect(
      nextBooked([{ status: InterviewStatus.PROPOSED, scheduledAt: null }], NOW),
    ).toBeNull();
  });

  it("ignores ones that have been", () => {
    expect(
      nextBooked(
        [{ status: InterviewStatus.CONFIRMED, scheduledAt: inHours(-24) }],
        NOW,
      ),
    ).toBeNull();
  });
});

describe("formatSlot", () => {
  it("always names the zone", () => {
    // An interview time without one is the most expensive ambiguity in this
    // whole feature: it is somebody missing a call about a job.
    const formatted = formatSlot(inHours(24), "en-US");
    expect(formatted.length).toBeGreaterThan(0);
    // A short zone name is appended by toLocaleString with timeZoneName.
    expect(formatted).toMatch(/[A-Z]{2,5}|GMT|UTC/);
  });

  it("is empty for a bad date rather than showing Invalid Date", () => {
    expect(formatSlot("nonsense")).toBe("");
  });
});

describe("formatDuration", () => {
  it("reads the way somebody blocks out a diary", () => {
    expect(formatDuration(30)).toBe("30 minutes");
    expect(formatDuration(60)).toBe("1h");
    expect(formatDuration(90)).toBe("1h 30m");
  });
});
