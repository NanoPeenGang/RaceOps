import { describe, expect, it } from "vitest";
import {
  EventStatus,
  RegistrationStatus,
  VolunteerSignupStatus,
} from "@prisma/client";
import {
  canOrganizerSetRegistrationStatus,
  canTransitionEvent,
  hasCapacityForConfirm,
  isRegistrationOpen,
  nextWaitlistPromotion,
  registrationWindowState,
  resolveVolunteerSignupStatus,
  shiftCoverage,
} from "@/lib/events";

const NOW = new Date("2026-06-01T12:00:00Z");
const EARLIER = new Date("2026-05-01T00:00:00Z");
const LATER = new Date("2026-07-01T00:00:00Z");

function evt(overrides: Partial<Parameters<typeof isRegistrationOpen>[0]> = {}) {
  return {
    status: EventStatus.PUBLISHED,
    registrationOpensAt: null,
    registrationClosesAt: null,
    ...overrides,
  };
}

describe("registration window", () => {
  it("is open for a published event with no window set", () => {
    expect(isRegistrationOpen(evt(), NOW)).toBe(true);
  });

  it("is open inside an explicit window", () => {
    expect(
      isRegistrationOpen(
        evt({ registrationOpensAt: EARLIER, registrationClosesAt: LATER }),
        NOW,
      ),
    ).toBe(true);
  });

  it("reports why it is shut", () => {
    expect(registrationWindowState(evt({ status: EventStatus.DRAFT }), NOW)).toBe(
      "not_published",
    );
    expect(
      registrationWindowState(evt({ status: EventStatus.CANCELED }), NOW),
    ).toBe("event_canceled");
    expect(
      registrationWindowState(evt({ registrationOpensAt: LATER }), NOW),
    ).toBe("not_yet_open");
    expect(
      registrationWindowState(evt({ registrationClosesAt: EARLIER }), NOW),
    ).toBe("closed");
  });

  it("treats a completed event as not accepting entries", () => {
    expect(isRegistrationOpen(evt({ status: EventStatus.COMPLETED }), NOW)).toBe(
      false,
    );
  });
});

describe("entry capacity", () => {
  it("allows unlimited grids", () => {
    expect(hasCapacityForConfirm(null, 999)).toBe(true);
  });

  it("blocks confirming past the cap", () => {
    expect(hasCapacityForConfirm(20, 19)).toBe(true);
    expect(hasCapacityForConfirm(20, 20)).toBe(false);
    expect(hasCapacityForConfirm(20, 21)).toBe(false);
  });
});

describe("organizer registration transitions", () => {
  it("permits the review decisions", () => {
    expect(
      canOrganizerSetRegistrationStatus(
        RegistrationStatus.PENDING,
        RegistrationStatus.CONFIRMED,
      ),
    ).toBe(true);
    expect(
      canOrganizerSetRegistrationStatus(
        RegistrationStatus.WAITLISTED,
        RegistrationStatus.CONFIRMED,
      ),
    ).toBe(true);
    expect(
      canOrganizerSetRegistrationStatus(
        RegistrationStatus.CONFIRMED,
        RegistrationStatus.REJECTED,
      ),
    ).toBe(true);
  });

  it("never lets an organizer withdraw on the entrant's behalf", () => {
    expect(
      canOrganizerSetRegistrationStatus(
        RegistrationStatus.CONFIRMED,
        RegistrationStatus.WITHDRAWN,
      ),
    ).toBe(false);
  });

  it("treats entrant withdrawal as final for organizers", () => {
    for (const to of [
      RegistrationStatus.PENDING,
      RegistrationStatus.CONFIRMED,
      RegistrationStatus.WAITLISTED,
      RegistrationStatus.REJECTED,
    ]) {
      expect(
        canOrganizerSetRegistrationStatus(RegistrationStatus.WITHDRAWN, to),
      ).toBe(false);
    }
  });

  it("rejects no-op transitions", () => {
    expect(
      canOrganizerSetRegistrationStatus(
        RegistrationStatus.PENDING,
        RegistrationStatus.PENDING,
      ),
    ).toBe(false);
  });
});

describe("waitlist promotion", () => {
  const base = { status: RegistrationStatus.WAITLISTED };

  it("promotes the longest-waiting entry", () => {
    const promoted = nextWaitlistPromotion([
      { ...base, id: "b", createdAt: new Date("2026-01-02") },
      { ...base, id: "a", createdAt: new Date("2026-01-01") },
      { ...base, id: "c", createdAt: new Date("2026-01-03") },
    ]);
    expect(promoted?.id).toBe("a");
  });

  it("ignores entries that are not waitlisted", () => {
    const promoted = nextWaitlistPromotion([
      {
        id: "confirmed",
        status: RegistrationStatus.CONFIRMED,
        createdAt: new Date("2026-01-01"),
      },
      {
        id: "rejected",
        status: RegistrationStatus.REJECTED,
        createdAt: new Date("2026-01-01"),
      },
    ]);
    expect(promoted).toBeNull();
  });

  it("returns null on an empty grid", () => {
    expect(nextWaitlistPromotion([])).toBeNull();
  });
});

describe("volunteer shifts", () => {
  it("fills slots before waitlisting", () => {
    expect(resolveVolunteerSignupStatus(3, 0)).toBe(
      VolunteerSignupStatus.SIGNED_UP,
    );
    expect(resolveVolunteerSignupStatus(3, 2)).toBe(
      VolunteerSignupStatus.SIGNED_UP,
    );
    expect(resolveVolunteerSignupStatus(3, 3)).toBe(
      VolunteerSignupStatus.WAITLISTED,
    );
  });

  it("counts coverage without counting canceled or waitlisted as filled", () => {
    const coverage = shiftCoverage(4, [
      { status: VolunteerSignupStatus.SIGNED_UP },
      { status: VolunteerSignupStatus.CONFIRMED },
      { status: VolunteerSignupStatus.CANCELED },
      { status: VolunteerSignupStatus.WAITLISTED },
      { status: VolunteerSignupStatus.WAITLISTED },
    ]);
    expect(coverage).toEqual({
      capacity: 4,
      filled: 2,
      waitlisted: 2,
      remaining: 2,
      isFull: false,
    });
  });

  it("reports a full shift", () => {
    const coverage = shiftCoverage(1, [
      { status: VolunteerSignupStatus.CONFIRMED },
    ]);
    expect(coverage.isFull).toBe(true);
    expect(coverage.remaining).toBe(0);
  });
});

describe("event lifecycle", () => {
  it("follows draft -> published -> completed", () => {
    expect(canTransitionEvent(EventStatus.DRAFT, EventStatus.PUBLISHED)).toBe(
      true,
    );
    expect(
      canTransitionEvent(EventStatus.PUBLISHED, EventStatus.COMPLETED),
    ).toBe(true);
  });

  it("allows cancelling before completion only", () => {
    expect(canTransitionEvent(EventStatus.DRAFT, EventStatus.CANCELED)).toBe(
      true,
    );
    expect(canTransitionEvent(EventStatus.PUBLISHED, EventStatus.CANCELED)).toBe(
      true,
    );
    expect(canTransitionEvent(EventStatus.COMPLETED, EventStatus.CANCELED)).toBe(
      false,
    );
  });

  it("treats completed and canceled as terminal", () => {
    for (const to of Object.values(EventStatus)) {
      expect(canTransitionEvent(EventStatus.COMPLETED, to)).toBe(false);
      expect(canTransitionEvent(EventStatus.CANCELED, to)).toBe(false);
    }
  });

  it("does not allow skipping publication", () => {
    expect(canTransitionEvent(EventStatus.DRAFT, EventStatus.COMPLETED)).toBe(
      false,
    );
  });
});
