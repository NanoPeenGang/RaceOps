import { AppealStatus, PenaltyStatus, PenaltyType } from "@prisma/client";

/**
 * Penalty and appeal rules. The two state machines are linked: filing an
 * appeal moves the penalty to UNDER_APPEAL, and the appeal ruling decides
 * where the penalty lands.
 */

export const PENALTY_TYPE_LABELS: Record<PenaltyType, string> = {
  TIME_PENALTY: "Time penalty",
  DRIVE_THROUGH: "Drive-through",
  STOP_GO: "Stop & go",
  GRID_DROP: "Grid drop",
  POINTS_DEDUCTION: "Points deduction",
  DISQUALIFICATION: "Disqualification",
  WARNING: "Warning",
  FINE: "Fine",
};

export const PENALTY_STATUS_LABELS: Record<PenaltyStatus, string> = {
  ISSUED: "Issued",
  UNDER_APPEAL: "Under appeal",
  UPHELD: "Upheld",
  REDUCED: "Reduced",
  OVERTURNED: "Overturned",
};

export const APPEAL_STATUS_LABELS: Record<AppealStatus, string> = {
  SUBMITTED: "Submitted",
  UNDER_REVIEW: "Under review",
  UPHELD: "Appeal upheld",
  REJECTED: "Appeal rejected",
};

/** Statuses at which a competitor may still challenge the decision. */
export const APPEALABLE_STATUSES: PenaltyStatus[] = [PenaltyStatus.ISSUED];

export function canAppeal(status: PenaltyStatus): boolean {
  return APPEALABLE_STATUSES.includes(status);
}

/** A decided appeal is final — only SUBMITTED/UNDER_REVIEW can be ruled on. */
export function isAppealOpen(status: AppealStatus): boolean {
  return (
    status === AppealStatus.SUBMITTED || status === AppealStatus.UNDER_REVIEW
  );
}

/**
 * Where a penalty lands once its appeal is decided.
 * An upheld appeal favours the competitor: the penalty is overturned, or
 * reduced when the panel keeps a lesser sanction.
 */
export type AppealOutcome =
  | typeof AppealStatus.UPHELD
  | typeof AppealStatus.REJECTED;

export function penaltyStatusAfterAppeal(
  appealOutcome: AppealOutcome,
  reduced: boolean,
): PenaltyStatus {
  if (appealOutcome === AppealStatus.REJECTED) return PenaltyStatus.UPHELD;
  return reduced ? PenaltyStatus.REDUCED : PenaltyStatus.OVERTURNED;
}

/** Which magnitude field an organizer must supply for a given penalty type. */
export function requiredMagnitudeField(
  type: PenaltyType,
): "timeSeconds" | "gridPlaces" | "pointsDeducted" | null {
  switch (type) {
    case PenaltyType.TIME_PENALTY:
      return "timeSeconds";
    case PenaltyType.GRID_DROP:
      return "gridPlaces";
    case PenaltyType.POINTS_DEDUCTION:
      return "pointsDeducted";
    default:
      return null;
  }
}

export interface PenaltyMagnitude {
  timeSeconds?: number | null;
  gridPlaces?: number | null;
  pointsDeducted?: number | null;
}

/**
 * A penalty must carry the magnitude its type implies — a time penalty with
 * no seconds, or a points deduction of zero, is not a decision anyone can act on.
 */
export function validatePenaltyMagnitude(
  type: PenaltyType,
  magnitude: PenaltyMagnitude,
): { ok: true } | { ok: false; field: string; message: string } {
  const field = requiredMagnitudeField(type);
  if (!field) return { ok: true };
  const value = magnitude[field];
  if (value === undefined || value === null || value <= 0) {
    return {
      ok: false,
      field,
      message: `${PENALTY_TYPE_LABELS[type]} requires a positive ${
        field === "timeSeconds"
          ? "time in seconds"
          : field === "gridPlaces"
            ? "number of grid places"
            : "points deduction"
      }.`,
    };
  }
  return { ok: true };
}

/** Human-readable magnitude, e.g. "+10s" or "-5 pts". */
export function describePenalty(penalty: {
  type: PenaltyType;
  timeSeconds: number | null;
  gridPlaces: number | null;
  pointsDeducted: number | null;
}): string {
  const label = PENALTY_TYPE_LABELS[penalty.type];
  switch (penalty.type) {
    case PenaltyType.TIME_PENALTY:
      return penalty.timeSeconds ? `${label} (+${penalty.timeSeconds}s)` : label;
    case PenaltyType.GRID_DROP:
      return penalty.gridPlaces
        ? `${label} (${penalty.gridPlaces} places)`
        : label;
    case PenaltyType.POINTS_DEDUCTION:
      return penalty.pointsDeducted
        ? `${label} (−${penalty.pointsDeducted} pts)`
        : label;
    default:
      return label;
  }
}
