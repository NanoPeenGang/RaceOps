import { describe, expect, it } from "vitest";
import { AppealStatus, PenaltyStatus, PenaltyType } from "@prisma/client";
import {
  canAppeal,
  describePenalty,
  isAppealOpen,
  penaltyStatusAfterAppeal,
  requiredMagnitudeField,
  validatePenaltyMagnitude,
} from "@/lib/penalties";

describe("appeal eligibility", () => {
  it("allows appealing a freshly issued penalty", () => {
    expect(canAppeal(PenaltyStatus.ISSUED)).toBe(true);
  });

  it("blocks appealing twice or after a ruling", () => {
    for (const status of [
      PenaltyStatus.UNDER_APPEAL,
      PenaltyStatus.UPHELD,
      PenaltyStatus.REDUCED,
      PenaltyStatus.OVERTURNED,
    ]) {
      expect(canAppeal(status)).toBe(false);
    }
  });
});

describe("appeal lifecycle", () => {
  it("is open until decided", () => {
    expect(isAppealOpen(AppealStatus.SUBMITTED)).toBe(true);
    expect(isAppealOpen(AppealStatus.UNDER_REVIEW)).toBe(true);
    expect(isAppealOpen(AppealStatus.UPHELD)).toBe(false);
    expect(isAppealOpen(AppealStatus.REJECTED)).toBe(false);
  });

  it("upholds the penalty when the appeal is rejected", () => {
    expect(penaltyStatusAfterAppeal(AppealStatus.REJECTED, false)).toBe(
      PenaltyStatus.UPHELD,
    );
    // A rejected appeal never reduces the sanction.
    expect(penaltyStatusAfterAppeal(AppealStatus.REJECTED, true)).toBe(
      PenaltyStatus.UPHELD,
    );
  });

  it("overturns the penalty when the appeal succeeds outright", () => {
    expect(penaltyStatusAfterAppeal(AppealStatus.UPHELD, false)).toBe(
      PenaltyStatus.OVERTURNED,
    );
  });

  it("reduces rather than overturns when a lesser sanction stands", () => {
    expect(penaltyStatusAfterAppeal(AppealStatus.UPHELD, true)).toBe(
      PenaltyStatus.REDUCED,
    );
  });
});

describe("penalty magnitude validation", () => {
  it("requires the field implied by the type", () => {
    expect(requiredMagnitudeField(PenaltyType.TIME_PENALTY)).toBe("timeSeconds");
    expect(requiredMagnitudeField(PenaltyType.GRID_DROP)).toBe("gridPlaces");
    expect(requiredMagnitudeField(PenaltyType.POINTS_DEDUCTION)).toBe(
      "pointsDeducted",
    );
    expect(requiredMagnitudeField(PenaltyType.WARNING)).toBeNull();
  });

  it("rejects a magnitude-carrying penalty with no magnitude", () => {
    const result = validatePenaltyMagnitude(PenaltyType.TIME_PENALTY, {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.field).toBe("timeSeconds");
  });

  it("rejects a zero or negative magnitude", () => {
    expect(
      validatePenaltyMagnitude(PenaltyType.POINTS_DEDUCTION, {
        pointsDeducted: 0,
      }).ok,
    ).toBe(false);
    expect(
      validatePenaltyMagnitude(PenaltyType.GRID_DROP, { gridPlaces: -3 }).ok,
    ).toBe(false);
  });

  it("accepts a valid magnitude", () => {
    expect(
      validatePenaltyMagnitude(PenaltyType.TIME_PENALTY, { timeSeconds: 10 }).ok,
    ).toBe(true);
  });

  it("accepts types that carry no magnitude", () => {
    for (const type of [
      PenaltyType.WARNING,
      PenaltyType.DISQUALIFICATION,
      PenaltyType.DRIVE_THROUGH,
      PenaltyType.STOP_GO,
      PenaltyType.FINE,
    ]) {
      expect(validatePenaltyMagnitude(type, {}).ok).toBe(true);
    }
  });
});

describe("describePenalty", () => {
  const base = { timeSeconds: null, gridPlaces: null, pointsDeducted: null };

  it("renders the magnitude inline", () => {
    expect(
      describePenalty({
        ...base,
        type: PenaltyType.TIME_PENALTY,
        timeSeconds: 10,
      }),
    ).toBe("Time penalty (+10s)");
    expect(
      describePenalty({
        ...base,
        type: PenaltyType.POINTS_DEDUCTION,
        pointsDeducted: 5,
      }),
    ).toBe("Points deduction (−5 pts)");
    expect(
      describePenalty({ ...base, type: PenaltyType.GRID_DROP, gridPlaces: 3 }),
    ).toBe("Grid drop (3 places)");
  });

  it("falls back to the plain label", () => {
    expect(describePenalty({ ...base, type: PenaltyType.WARNING })).toBe(
      "Warning",
    );
  });
});
