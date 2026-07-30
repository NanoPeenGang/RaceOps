import { describe, expect, it } from "vitest";
import { CheckResult, InspectionStage, InspectionStatus } from "@prisma/client";
import {
  CHECK_RESULT_LABELS,
  INSPECTION_STAGE_LABELS,
  INSPECTION_STATUS_LABELS,
  blocksRunning,
  currentInspection,
  deriveInspectionStatus,
  failedChecks,
  formatTolerance,
  inspectionProgress,
  isMeasured,
  resultFromMeasurement,
  summarizeInspection,
  type CheckRecord,
} from "@/lib/scrutineering";

function check(overrides: Partial<CheckRecord> = {}): CheckRecord {
  return {
    id: "c1",
    label: "Seat belts in date",
    result: CheckResult.PENDING,
    measuredValue: null,
    minValue: null,
    maxValue: null,
    measureUnit: null,
    ...overrides,
  };
}

describe("label maps", () => {
  it("labels every stage, status and result", () => {
    for (const stage of Object.values(InspectionStage)) {
      expect(INSPECTION_STAGE_LABELS[stage], stage).toBeTruthy();
    }
    for (const status of Object.values(InspectionStatus)) {
      expect(INSPECTION_STATUS_LABELS[status], status).toBeTruthy();
    }
    for (const result of Object.values(CheckResult)) {
      expect(CHECK_RESULT_LABELS[result], result).toBeTruthy();
    }
  });
});

describe("isMeasured", () => {
  it("is true when a unit or a bound is set", () => {
    expect(isMeasured(check({ measureUnit: "kg" }))).toBe(true);
    expect(isMeasured(check({ minValue: 1250 }))).toBe(true);
    expect(isMeasured(check({ maxValue: 40 }))).toBe(true);
  });

  it("is false for a plain pass/fail check", () => {
    expect(isMeasured(check())).toBe(false);
  });
});

describe("resultFromMeasurement", () => {
  it("passes a value inside the tolerance", () => {
    expect(
      resultFromMeasurement(
        check({ measuredValue: 1300, minValue: 1250, maxValue: 1400 }),
      ),
    ).toBe(CheckResult.PASS);
  });

  it("passes on the boundary — a limit is inclusive", () => {
    // "Minimum weight 1250 kg" means 1250 is legal.
    expect(
      resultFromMeasurement(check({ measuredValue: 1250, minValue: 1250 })),
    ).toBe(CheckResult.PASS);
    expect(
      resultFromMeasurement(check({ measuredValue: 40, maxValue: 40 })),
    ).toBe(CheckResult.PASS);
  });

  it("fails under a minimum and over a maximum", () => {
    expect(
      resultFromMeasurement(check({ measuredValue: 1249, minValue: 1250 })),
    ).toBe(CheckResult.FAIL);
    expect(
      resultFromMeasurement(check({ measuredValue: 41, maxValue: 40 })),
    ).toBe(CheckResult.FAIL);
  });

  it("returns null when there is nothing to derive from", () => {
    // The scrutineer's own verdict stands in these cases.
    expect(resultFromMeasurement(check({ minValue: 1250 }))).toBeNull();
    expect(resultFromMeasurement(check({ measuredValue: 1300 }))).toBeNull();
  });
});

describe("formatTolerance", () => {
  it("formats a range, a floor and a ceiling", () => {
    expect(
      formatTolerance(check({ minValue: 1250, maxValue: 1400, measureUnit: "kg" })),
    ).toBe("1250–1400 kg");
    expect(formatTolerance(check({ minValue: 1250, measureUnit: "kg" }))).toBe(
      "≥ 1250 kg",
    );
    expect(formatTolerance(check({ maxValue: 40, measureUnit: "mm" }))).toBe(
      "≤ 40 mm",
    );
  });

  it("is empty for a plain check", () => {
    expect(formatTolerance(check())).toBe("");
  });
});

describe("inspectionProgress", () => {
  it("counts each outcome", () => {
    const progress = inspectionProgress([
      check({ id: "a", result: CheckResult.PASS }),
      check({ id: "b", result: CheckResult.FAIL }),
      check({ id: "c", result: CheckResult.NOT_APPLICABLE }),
      check({ id: "d" }),
    ]);
    expect(progress).toEqual({
      total: 4,
      checked: 3,
      passed: 1,
      failed: 1,
      notApplicable: 1,
      pending: 1,
      complete: false,
    });
  });

  it("is complete only when nothing is pending", () => {
    expect(
      inspectionProgress([check({ result: CheckResult.PASS })]).complete,
    ).toBe(true);
  });

  it("is not complete for an empty card", () => {
    // An empty card has not been worked through; it has nothing on it.
    expect(inspectionProgress([]).complete).toBe(false);
  });
});

describe("deriveInspectionStatus", () => {
  it("stays not started until something is checked", () => {
    expect(
      deriveInspectionStatus([check(), check({ id: "b" })], InspectionStatus.NOT_STARTED),
    ).toBe(InspectionStatus.NOT_STARTED);
  });

  it("reads as in progress once a check is recorded", () => {
    expect(
      deriveInspectionStatus(
        [check({ result: CheckResult.PASS }), check({ id: "b" })],
        InspectionStatus.NOT_STARTED,
      ),
    ).toBe(InspectionStatus.IN_PROGRESS);
  });

  it("does not fail the card until the scrutineer has finished", () => {
    // One early failure should not close a card that is still being worked.
    expect(
      deriveInspectionStatus(
        [check({ result: CheckResult.FAIL }), check({ id: "b" })],
        InspectionStatus.IN_PROGRESS,
      ),
    ).toBe(InspectionStatus.IN_PROGRESS);
  });

  it("fails a completed card with any failure", () => {
    expect(
      deriveInspectionStatus(
        [
          check({ result: CheckResult.PASS }),
          check({ id: "b", result: CheckResult.FAIL }),
        ],
        InspectionStatus.IN_PROGRESS,
      ),
    ).toBe(InspectionStatus.FAILED);
  });

  it("passes a completed card with no failures", () => {
    expect(
      deriveInspectionStatus(
        [
          check({ result: CheckResult.PASS }),
          check({ id: "b", result: CheckResult.NOT_APPLICABLE }),
        ],
        InspectionStatus.IN_PROGRESS,
      ),
    ).toBe(InspectionStatus.PASSED);
  });

  it("never recomputes a referral away", () => {
    // Referring to the stewards is a human decision, not a derived state.
    expect(
      deriveInspectionStatus(
        [check({ result: CheckResult.PASS })],
        InspectionStatus.REFERRED,
      ),
    ).toBe(InspectionStatus.REFERRED);
  });
});

describe("blocksRunning", () => {
  it("blocks on a failure or a referral", () => {
    expect(blocksRunning(InspectionStatus.FAILED)).toBe(true);
    expect(blocksRunning(InspectionStatus.REFERRED)).toBe(true);
  });

  it("does not block on a pass or work in progress", () => {
    expect(blocksRunning(InspectionStatus.PASSED)).toBe(false);
    expect(blocksRunning(InspectionStatus.IN_PROGRESS)).toBe(false);
    expect(blocksRunning(InspectionStatus.NOT_STARTED)).toBe(false);
  });
});

describe("currentInspection", () => {
  const older = {
    id: "first",
    stage: InspectionStage.PRE_EVENT,
    createdAt: new Date("2026-06-01T09:00:00Z"),
  };
  const recheck = {
    id: "recheck",
    stage: InspectionStage.PRE_EVENT,
    createdAt: new Date("2026-06-01T11:00:00Z"),
  };
  const postRace = {
    id: "post",
    stage: InspectionStage.POST_RACE,
    createdAt: new Date("2026-06-01T18:00:00Z"),
  };

  it("takes the newest card at the stage — a re-check supersedes a failure", () => {
    expect(
      currentInspection([older, recheck, postRace], InspectionStage.PRE_EVENT)
        ?.id,
    ).toBe("recheck");
  });

  it("keeps stages apart", () => {
    expect(
      currentInspection([older, recheck, postRace], InspectionStage.POST_RACE)
        ?.id,
    ).toBe("post");
    expect(
      currentInspection([older, recheck], InspectionStage.IN_EVENT),
    ).toBeNull();
  });

  it("is null with no inspections", () => {
    expect(currentInspection([], InspectionStage.PRE_EVENT)).toBeNull();
  });
});

describe("failedChecks and summarizeInspection", () => {
  it("lists only the failures", () => {
    const checks = [
      check({ id: "a", result: CheckResult.PASS }),
      check({ id: "b", result: CheckResult.FAIL, label: "Ride height" }),
    ];
    expect(failedChecks(checks).map((c) => c.label)).toEqual(["Ride height"]);
  });

  it("summarizes each state of a card", () => {
    expect(summarizeInspection([])).toBe("No checks");
    expect(
      summarizeInspection([check({ result: CheckResult.PASS }), check({ id: "b" })]),
    ).toBe("1 of 2 checked");
    expect(
      summarizeInspection([
        check({ result: CheckResult.PASS }),
        check({ id: "b", result: CheckResult.PASS }),
      ]),
    ).toBe("All 2 passed");
    expect(
      summarizeInspection([
        check({ result: CheckResult.FAIL }),
        check({ id: "b", result: CheckResult.PASS }),
      ]),
    ).toBe("1 of 2 failed");
  });
});
