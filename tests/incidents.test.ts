import { describe, expect, it } from "vitest";
import { IncidentSource, IncidentStatus } from "@prisma/client";
import {
  CLOSED_INCIDENT_STATUSES,
  INCIDENT_SOURCE_LABELS,
  INCIDENT_STATUS_LABELS,
  canIssuePenaltyFor,
  canTransitionIncident,
  describeIncidentLocation,
  isIncidentOpen,
  nextIncidentStatuses,
  sortIncidentQueue,
  summarizeQueue,
  type IncidentRecord,
} from "@/lib/incidents";

function incident(overrides: Partial<IncidentRecord> = {}): IncidentRecord {
  return {
    id: "i1",
    status: IncidentStatus.REPORTED,
    source: IncidentSource.COMPETITOR,
    lapNumber: null,
    createdAt: new Date("2026-06-14T12:00:00Z"),
    ...overrides,
  };
}

describe("label maps", () => {
  it("labels every source and status", () => {
    for (const source of Object.values(IncidentSource)) {
      expect(INCIDENT_SOURCE_LABELS[source], source).toBeTruthy();
    }
    for (const status of Object.values(IncidentStatus)) {
      expect(INCIDENT_STATUS_LABELS[status], status).toBeTruthy();
    }
  });
});

describe("isIncidentOpen", () => {
  it("treats reported, noted and investigating as open", () => {
    expect(isIncidentOpen(IncidentStatus.REPORTED)).toBe(true);
    expect(isIncidentOpen(IncidentStatus.NOTED)).toBe(true);
    expect(isIncidentOpen(IncidentStatus.UNDER_INVESTIGATION)).toBe(true);
  });

  it("treats every closing status as closed", () => {
    for (const status of CLOSED_INCIDENT_STATUSES) {
      expect(isIncidentOpen(status), status).toBe(false);
    }
  });
});

describe("canTransitionIncident", () => {
  it("walks a report through triage to a decision", () => {
    expect(
      canTransitionIncident(IncidentStatus.REPORTED, IncidentStatus.NOTED),
    ).toBe(true);
    expect(
      canTransitionIncident(
        IncidentStatus.NOTED,
        IncidentStatus.UNDER_INVESTIGATION,
      ),
    ).toBe(true);
    expect(
      canTransitionIncident(
        IncidentStatus.UNDER_INVESTIGATION,
        IncidentStatus.NO_FURTHER_ACTION,
      ),
    ).toBe(true);
  });

  it("allows closing a report immediately without investigating", () => {
    expect(
      canTransitionIncident(
        IncidentStatus.REPORTED,
        IncidentStatus.NO_FURTHER_ACTION,
      ),
    ).toBe(true);
  });

  it("never moves a closed report", () => {
    for (const closed of CLOSED_INCIDENT_STATUSES) {
      for (const target of Object.values(IncidentStatus)) {
        expect(
          canTransitionIncident(closed, target),
          `${closed}->${target}`,
        ).toBe(false);
      }
    }
  });

  it("does not walk backwards out of an investigation", () => {
    expect(
      canTransitionIncident(
        IncidentStatus.UNDER_INVESTIGATION,
        IncidentStatus.NOTED,
      ),
    ).toBe(false);
  });

  it("refuses a no-op transition", () => {
    expect(
      canTransitionIncident(IncidentStatus.NOTED, IncidentStatus.NOTED),
    ).toBe(false);
  });

  it("never offers PENALTY_ISSUED as a status change", () => {
    // That state is reached by issuing a penalty, not by editing a dropdown.
    for (const status of Object.values(IncidentStatus)) {
      expect(nextIncidentStatuses(status)).not.toContain(
        IncidentStatus.PENALTY_ISSUED,
      );
    }
  });

  it("agrees with nextIncidentStatuses", () => {
    for (const from of Object.values(IncidentStatus)) {
      for (const to of Object.values(IncidentStatus)) {
        expect(canTransitionIncident(from, to)).toBe(
          nextIncidentStatuses(from).includes(to),
        );
      }
    }
  });
});

describe("canIssuePenaltyFor", () => {
  it("allows a penalty while the report is open", () => {
    expect(canIssuePenaltyFor(IncidentStatus.REPORTED)).toBe(true);
    expect(canIssuePenaltyFor(IncidentStatus.UNDER_INVESTIGATION)).toBe(true);
  });

  it("refuses one on a report already closed", () => {
    expect(canIssuePenaltyFor(IncidentStatus.NO_FURTHER_ACTION)).toBe(false);
    expect(canIssuePenaltyFor(IncidentStatus.PENALTY_ISSUED)).toBe(false);
    expect(canIssuePenaltyFor(IncidentStatus.WITHDRAWN)).toBe(false);
  });
});

describe("sortIncidentQueue", () => {
  const at = (iso: string) => new Date(iso);

  it("puts open reports before closed ones", () => {
    const rows = sortIncidentQueue([
      incident({ id: "closed", status: IncidentStatus.NO_FURTHER_ACTION }),
      incident({ id: "open", status: IncidentStatus.REPORTED }),
    ]);
    expect(rows.map((r) => r.id)).toEqual(["open", "closed"]);
  });

  it("puts formal protests ahead of casual reports", () => {
    const rows = sortIncidentQueue([
      incident({ id: "casual", createdAt: at("2026-06-14T10:00:00Z") }),
      incident({
        id: "protest",
        source: IncidentSource.PROTEST,
        createdAt: at("2026-06-14T11:00:00Z"),
      }),
    ]);
    // A protest carries a fee and a deadline, so it jumps the queue.
    expect(rows.map((r) => r.id)).toEqual(["protest", "casual"]);
  });

  it("works the rest of the queue oldest first", () => {
    const rows = sortIncidentQueue([
      incident({ id: "newer", createdAt: at("2026-06-14T12:00:00Z") }),
      incident({ id: "older", createdAt: at("2026-06-14T09:00:00Z") }),
    ]);
    expect(rows.map((r) => r.id)).toEqual(["older", "newer"]);
  });

  it("does not mutate the input", () => {
    const rows = [
      incident({ id: "b", status: IncidentStatus.WITHDRAWN }),
      incident({ id: "a" }),
    ];
    sortIncidentQueue(rows);
    expect(rows[0].id).toBe("b");
  });

  it("handles an empty queue", () => {
    expect(sortIncidentQueue([])).toEqual([]);
  });
});

describe("summarizeQueue", () => {
  it("counts open, investigating, protests and closed", () => {
    const summary = summarizeQueue([
      incident({ status: IncidentStatus.REPORTED }),
      incident({ status: IncidentStatus.UNDER_INVESTIGATION }),
      incident({
        status: IncidentStatus.NOTED,
        source: IncidentSource.PROTEST,
      }),
      incident({ status: IncidentStatus.PENALTY_ISSUED }),
      incident({ status: IncidentStatus.NO_FURTHER_ACTION }),
    ]);
    expect(summary).toEqual({
      open: 3,
      investigating: 1,
      protests: 1,
      closed: 2,
    });
  });

  it("does not count a closed protest as outstanding", () => {
    const summary = summarizeQueue([
      incident({
        status: IncidentStatus.NO_FURTHER_ACTION,
        source: IncidentSource.PROTEST,
      }),
    ]);
    expect(summary.protests).toBe(0);
    expect(summary.closed).toBe(1);
  });

  it("is zeroed for an empty queue", () => {
    expect(summarizeQueue([])).toEqual({
      open: 0,
      investigating: 0,
      protests: 0,
      closed: 0,
    });
  });
});

describe("describeIncidentLocation", () => {
  it("combines lap and place", () => {
    expect(
      describeIncidentLocation({ lapNumber: 12, location: "Turn 5" }),
    ).toBe("Lap 12, Turn 5");
  });

  it("uses whichever part was given", () => {
    expect(describeIncidentLocation({ lapNumber: 12, location: null })).toBe(
      "Lap 12",
    );
    expect(
      describeIncidentLocation({ lapNumber: null, location: "Pit exit" }),
    ).toBe("Pit exit");
  });

  it("says so when neither was given", () => {
    expect(
      describeIncidentLocation({ lapNumber: null, location: null }),
    ).toBe("Location not given");
  });
});
