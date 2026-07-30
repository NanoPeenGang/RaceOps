import { CheckResult, InspectionStage, InspectionStatus } from "@prisma/client";

/**
 * Technical inspection.
 *
 * A scrutineer works a card of checks against one car. Some are pass/fail;
 * some record a measurement against a tolerance, where the pass/fail follows
 * from the number rather than from an opinion.
 */

export const INSPECTION_STAGE_LABELS: Record<InspectionStage, string> = {
  PRE_EVENT: "Pre-event",
  IN_EVENT: "In-event",
  POST_RACE: "Post-race / impound",
};

export const INSPECTION_STATUS_LABELS: Record<InspectionStatus, string> = {
  NOT_STARTED: "Not started",
  IN_PROGRESS: "In progress",
  PASSED: "Passed",
  FAILED: "Failed",
  REFERRED: "Referred to stewards",
};

export const CHECK_RESULT_LABELS: Record<CheckResult, string> = {
  PENDING: "Not checked",
  PASS: "Pass",
  FAIL: "Fail",
  NOT_APPLICABLE: "N/A",
};

export interface CheckRecord {
  id: string;
  label: string;
  result: CheckResult;
  measuredValue: number | null;
  minValue: number | null;
  maxValue: number | null;
  measureUnit: string | null;
}

/** True when the check records a number rather than a bare pass/fail. */
export function isMeasured(
  check: Pick<CheckRecord, "measureUnit" | "minValue" | "maxValue">,
): boolean {
  return (
    check.measureUnit !== null ||
    check.minValue !== null ||
    check.maxValue !== null
  );
}

/**
 * Pass/fail implied by a measurement against its tolerance.
 *
 * Returns null when the check takes no measurement or none was recorded — the
 * scrutineer's own verdict stands in that case.
 */
export function resultFromMeasurement(
  check: Pick<
    CheckRecord,
    "measuredValue" | "minValue" | "maxValue" | "measureUnit"
  >,
): CheckResult | null {
  if (check.measuredValue === null || check.measuredValue === undefined) {
    return null;
  }
  if (check.minValue === null && check.maxValue === null) return null;
  if (check.minValue !== null && check.measuredValue < check.minValue) {
    return CheckResult.FAIL;
  }
  if (check.maxValue !== null && check.measuredValue > check.maxValue) {
    return CheckResult.FAIL;
  }
  return CheckResult.PASS;
}

/** How a tolerance reads on the card, e.g. "1250–1400 kg" or "≤ 40 mm". */
export function formatTolerance(
  check: Pick<CheckRecord, "minValue" | "maxValue" | "measureUnit">,
): string {
  const unit = check.measureUnit ? ` ${check.measureUnit}` : "";
  if (check.minValue !== null && check.maxValue !== null) {
    return `${check.minValue}–${check.maxValue}${unit}`;
  }
  if (check.minValue !== null) return `≥ ${check.minValue}${unit}`;
  if (check.maxValue !== null) return `≤ ${check.maxValue}${unit}`;
  return unit.trim();
}

export interface InspectionProgress {
  total: number;
  checked: number;
  passed: number;
  failed: number;
  notApplicable: number;
  pending: number;
  complete: boolean;
}

export function inspectionProgress(checks: CheckRecord[]): InspectionProgress {
  let passed = 0;
  let failed = 0;
  let notApplicable = 0;
  let pending = 0;

  for (const check of checks) {
    switch (check.result) {
      case CheckResult.PASS:
        passed += 1;
        break;
      case CheckResult.FAIL:
        failed += 1;
        break;
      case CheckResult.NOT_APPLICABLE:
        notApplicable += 1;
        break;
      default:
        pending += 1;
    }
  }

  return {
    total: checks.length,
    checked: checks.length - pending,
    passed,
    failed,
    notApplicable,
    pending,
    complete: checks.length > 0 && pending === 0,
  };
}

/**
 * The status an inspection has reached, derived from its checks.
 *
 * A single failure fails the card — that is what scrutineering means — but the
 * status only settles once every check has been worked through, so a card with
 * one early fail still reads as in progress until the scrutineer finishes.
 */
export function deriveInspectionStatus(
  checks: CheckRecord[],
  current: InspectionStatus,
): InspectionStatus {
  // A referral is a human decision and is never recomputed away.
  if (current === InspectionStatus.REFERRED) return current;

  const progress = inspectionProgress(checks);
  if (progress.total === 0) return InspectionStatus.NOT_STARTED;
  if (progress.checked === 0) return InspectionStatus.NOT_STARTED;
  if (!progress.complete) return InspectionStatus.IN_PROGRESS;
  return progress.failed > 0
    ? InspectionStatus.FAILED
    : InspectionStatus.PASSED;
}

/** Statuses that mean the car is not cleared to run. */
export const BLOCKING_INSPECTION_STATUSES: InspectionStatus[] = [
  InspectionStatus.FAILED,
  InspectionStatus.REFERRED,
];

export function blocksRunning(status: InspectionStatus): boolean {
  return BLOCKING_INSPECTION_STATUSES.includes(status);
}

/**
 * The inspection that represents a car's current standing at a stage: the
 * newest one, since a re-check supersedes the failure that prompted it.
 */
export function currentInspection<
  T extends { stage: InspectionStage; createdAt: Date },
>(inspections: T[], stage: InspectionStage): T | null {
  const atStage = inspections
    .filter((inspection) => inspection.stage === stage)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return atStage[0] ?? null;
}

/** Checks that failed — the list a scrutineer hands to the entrant. */
export function failedChecks<T extends Pick<CheckRecord, "result">>(
  checks: T[],
): T[] {
  return checks.filter((check) => check.result === CheckResult.FAIL);
}

/** One-line summary of a card for a list view. */
export function summarizeInspection(checks: CheckRecord[]): string {
  const progress = inspectionProgress(checks);
  if (progress.total === 0) return "No checks";
  if (progress.failed > 0) {
    return `${progress.failed} of ${progress.total} failed`;
  }
  if (!progress.complete) {
    return `${progress.checked} of ${progress.total} checked`;
  }
  return `All ${progress.total} passed`;
}
