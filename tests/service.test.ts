import { describe, expect, it } from "vitest";
import { ServiceKind, ServiceStatus } from "@prisma/client";
import {
  DUE_SOON_DAYS,
  SERVICE_KIND_LABELS,
  SERVICE_STATUS_LABELS,
  assessDue,
  hasOverdueWork,
  isOpen,
  upcomingServices,
} from "@/lib/service";

const NOW = new Date("2026-06-01T12:00:00Z");
const inDays = (days: number) =>
  new Date(NOW.getTime() + days * 86_400_000);

describe("service vocabulary", () => {
  it("labels every kind and status", () => {
    for (const kind of Object.values(ServiceKind)) {
      expect(SERVICE_KIND_LABELS[kind], kind).toBeTruthy();
    }
    for (const status of Object.values(ServiceStatus)) {
      expect(SERVICE_STATUS_LABELS[status], status).toBeTruthy();
    }
  });

  it("counts planned and in-progress as open work", () => {
    expect(isOpen(ServiceStatus.PLANNED)).toBe(true);
    expect(isOpen(ServiceStatus.IN_PROGRESS)).toBe(true);
    expect(isOpen(ServiceStatus.DONE)).toBe(false);
    expect(isOpen(ServiceStatus.DEFERRED)).toBe(false);
  });
});

describe("assessDue: by date", () => {
  it("is overdue past the date, and says by how much", () => {
    const due = assessDue({ nextDueOn: inDays(-3) }, null, NOW);
    expect(due.urgency).toBe("overdue");
    expect(due.summary).toContain("3 days");
  });

  it("warns inside the window", () => {
    expect(assessDue({ nextDueOn: inDays(7) }, null, NOW).urgency).toBe(
      "due-soon",
    );
    expect(
      assessDue({ nextDueOn: inDays(DUE_SOON_DAYS) }, null, NOW).urgency,
    ).toBe("due-soon");
  });

  it("is quiet outside it", () => {
    expect(assessDue({ nextDueOn: inDays(60) }, null, NOW).urgency).toBe(
      "scheduled",
    );
  });
});

describe("assessDue: by running hours", () => {
  it("measures against the car's hours", () => {
    expect(assessDue({ nextDueHours: 40 }, 38, NOW).urgency).toBe("due-soon");
    expect(assessDue({ nextDueHours: 40 }, 42, NOW).urgency).toBe("overdue");
    expect(assessDue({ nextDueHours: 40 }, 10, NOW).urgency).toBe("scheduled");
  });

  it("says it cannot tell when the car has no hours recorded", () => {
    // Reporting this as fine is how a rebuild gets missed: the interval
    // exists, we just cannot say where the car is against it.
    const due = assessDue({ nextDueHours: 40 }, null, NOW);
    expect(due.urgency).toBe("unknown");
    expect(due.summary).toContain("no hours recorded");
  });
});

describe("assessDue: neither", () => {
  it("is unknown rather than scheduled when nothing is set", () => {
    // "scheduled" would promise a warning that is never going to come.
    const due = assessDue({}, 10, NOW);
    expect(due.urgency).toBe("unknown");
    expect(due.summary).toBe("No interval set.");
  });
});

describe("assessDue: both", () => {
  it("takes whichever arrives first", () => {
    const due = assessDue({ nextDueOn: inDays(90), nextDueHours: 40 }, 41, NOW);
    expect(due.urgency).toBe("overdue");
  });

  it("reports both remainders so the console can show either", () => {
    const due = assessDue({ nextDueOn: inDays(30), nextDueHours: 40 }, 20, NOW);
    expect(Math.round(due.daysRemaining!)).toBe(30);
    expect(due.hoursRemaining).toBe(20);
  });
});

describe("upcomingServices", () => {
  const gearbox = {
    id: "gearbox",
    status: ServiceStatus.PLANNED,
    nextDueOn: inDays(-2),
  };
  const belts = {
    id: "belts",
    status: ServiceStatus.PLANNED,
    nextDueOn: inDays(5),
  };
  const logbook = {
    id: "logbook",
    status: ServiceStatus.DONE,
    nextDueOn: inDays(200),
  };
  const noInterval = { id: "none", status: ServiceStatus.PLANNED };
  const deferred = {
    id: "deferred",
    status: ServiceStatus.DEFERRED,
    nextDueOn: inDays(-30),
  };

  it("sorts most urgent first", () => {
    const list = upcomingServices([logbook, belts, gearbox], null, NOW);
    expect(list.map((row) => row.service.id)).toEqual([
      "gearbox",
      "belts",
      "logbook",
    ]);
  });

  it("leaves out jobs with no interval", () => {
    const list = upcomingServices([noInterval, belts], null, NOW);
    expect(list.map((row) => row.service.id)).toEqual(["belts"]);
  });

  it("stops nagging about a deferred job", () => {
    // Deferring is a decision to stop being reminded. A "deferred" job that
    // keeps topping the list is just one nobody can silence.
    const list = upcomingServices([deferred], null, NOW);
    expect(list).toEqual([]);
  });
});

describe("hasOverdueWork", () => {
  it("is true only for overdue, not for due soon", () => {
    // Conflating them makes the warning that matters invisible.
    expect(
      hasOverdueWork(
        [{ status: ServiceStatus.PLANNED, nextDueOn: inDays(3) }],
        null,
        NOW,
      ),
    ).toBe(false);
    expect(
      hasOverdueWork(
        [{ status: ServiceStatus.PLANNED, nextDueOn: inDays(-1) }],
        null,
        NOW,
      ),
    ).toBe(true);
  });

  it("is false for a car with nothing recorded", () => {
    expect(hasOverdueWork([], null, NOW)).toBe(false);
  });
});
