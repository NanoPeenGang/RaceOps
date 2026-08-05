import { describe, expect, it } from "vitest";
import { PitStopKind, PitStopStatus } from "@prisma/client";
import {
  PIT_STOP_KIND_LABELS,
  PIT_STOP_STATUS_LABELS,
  checkPlan,
  formatStopSeconds,
  nextSequence,
  nextStop,
  stopTiming,
} from "@/lib/pit-stops";
import type { PitStopRecord } from "@/lib/pit-stops";

const stop = (over: Partial<PitStopRecord> & { id: string }): PitStopRecord => ({
  sequence: 1,
  kind: PitStopKind.FUEL,
  status: PitStopStatus.PLANNED,
  ...over,
});

describe("pit stop vocabulary", () => {
  it("labels every kind and status", () => {
    for (const kind of Object.values(PitStopKind)) {
      expect(PIT_STOP_KIND_LABELS[kind], kind).toBeTruthy();
    }
    for (const status of Object.values(PitStopStatus)) {
      expect(PIT_STOP_STATUS_LABELS[status], status).toBeTruthy();
    }
  });
});

describe("checkPlan", () => {
  it("is happy with a plain plan", () => {
    const problems = checkPlan([
      stop({ id: "a", sequence: 1, targetLap: 30 }),
      stop({ id: "b", sequence: 2, targetLap: 60 }),
    ]);
    expect(problems).toEqual([]);
  });

  it("catches two stops with the same number", () => {
    const problems = checkPlan([
      stop({ id: "a", sequence: 2, targetLap: 30 }),
      stop({ id: "b", sequence: 2, targetLap: 60 }),
    ]);
    expect(problems.map((p) => p.code)).toContain("DUPLICATE_SEQUENCE");
  });

  it("catches a stop planned before the one ahead of it", () => {
    // Silently breaks every fuel calculation downstream, and looks fine
    // stop-by-stop.
    const problems = checkPlan([
      stop({ id: "a", sequence: 1, targetLap: 60 }),
      stop({ id: "b", sequence: 2, targetLap: 30 }),
    ]);
    expect(problems.map((p) => p.code)).toContain("OUT_OF_ORDER");
  });

  it("treats a missing target as incomplete, not wrong", () => {
    const problems = checkPlan([stop({ id: "a" })]);
    expect(problems).toHaveLength(1);
    expect(problems[0]!.code).toBe("NO_TARGET");
    // A half-built plan is the normal state at 9am on a Saturday.
    expect(problems[0]!.severity).toBe("warning");
  });

  it("refuses the same driver getting in and out", () => {
    const problems = checkPlan([
      stop({ id: "a", targetLap: 10, driverInId: "x", driverOutId: "x" }),
    ]);
    const found = problems.find((p) => p.code === "DRIVER_IN_EQUALS_OUT");
    expect(found?.severity).toBe("error");
  });

  it("flags a driver change with nobody getting in", () => {
    const problems = checkPlan([
      stop({ id: "a", targetLap: 10, kind: PitStopKind.DRIVER_CHANGE }),
    ]);
    expect(problems.map((p) => p.code)).toContain("CHANGE_WITHOUT_DRIVER");
  });

  it("catches a handover that does not join up", () => {
    // Stop 2 takes out C, but B was in the car. The classic midnight
    // rotation-reshuffle error: every row is individually plausible.
    const problems = checkPlan([
      stop({ id: "a", sequence: 1, targetLap: 30, driverInId: "b" }),
      stop({
        id: "b",
        sequence: 2,
        targetLap: 60,
        driverOutId: "c",
        driverInId: "d",
      }),
    ]);
    const found = problems.find((p) => p.code === "HANDOVER_MISMATCH");
    expect(found?.severity).toBe("error");
  });

  it("accepts a handover that does join up", () => {
    const problems = checkPlan([
      stop({ id: "a", sequence: 1, targetLap: 30, driverInId: "b" }),
      stop({
        id: "b",
        sequence: 2,
        targetLap: 60,
        driverOutId: "b",
        driverInId: "c",
      }),
    ]);
    expect(problems.map((p) => p.code)).not.toContain("HANDOVER_MISMATCH");
  });

  it("ignores skipped stops when following the handover chain", () => {
    // A skipped stop never happened, so the driver it would have swapped is
    // still in the car — reading it as real produces a false alarm.
    const problems = checkPlan([
      stop({ id: "a", sequence: 1, targetLap: 20, driverInId: "b" }),
      stop({
        id: "b",
        sequence: 2,
        targetLap: 40,
        status: PitStopStatus.SKIPPED,
        driverOutId: "b",
        driverInId: "z",
      }),
      stop({
        id: "c",
        sequence: 3,
        targetLap: 60,
        driverOutId: "b",
        driverInId: "c",
      }),
    ]);
    expect(problems.map((p) => p.code)).not.toContain("HANDOVER_MISMATCH");
  });

  it("flags a completed stop with no time on it", () => {
    const problems = checkPlan([
      stop({ id: "a", targetLap: 10, status: PitStopStatus.COMPLETED }),
    ]);
    expect(problems.map((p) => p.code)).toContain("COMPLETED_WITHOUT_TIME");
  });

  it("checks out-of-order against sequence, not input order", () => {
    const problems = checkPlan([
      stop({ id: "b", sequence: 2, targetLap: 60 }),
      stop({ id: "a", sequence: 1, targetLap: 30 }),
    ]);
    expect(problems).toEqual([]);
  });
});

describe("nextSequence", () => {
  it("continues from the highest, not the count", () => {
    // Deleting stop 2 of three must not hand out 3 again.
    expect(nextSequence([{ sequence: 1 }, { sequence: 3 }])).toBe(4);
  });

  it("starts at one", () => {
    expect(nextSequence([])).toBe(1);
  });
});

describe("nextStop", () => {
  it("is the lowest-numbered stop still planned", () => {
    const found = nextStop([
      stop({ id: "a", sequence: 1, status: PitStopStatus.COMPLETED }),
      stop({ id: "c", sequence: 3 }),
      stop({ id: "b", sequence: 2 }),
    ]);
    expect(found?.id).toBe("b");
  });

  it("passes over skipped stops", () => {
    const found = nextStop([
      stop({ id: "a", sequence: 1, status: PitStopStatus.SKIPPED }),
      stop({ id: "b", sequence: 2 }),
    ]);
    expect(found?.id).toBe("b");
  });

  it("is null when the plan is finished, rather than showing stop 1 again", () => {
    expect(
      nextStop([stop({ id: "a", status: PitStopStatus.COMPLETED })]),
    ).toBeNull();
  });
});

describe("stopTiming", () => {
  it("counts completed stops but averages only the timed ones", () => {
    // Including an untimed stop as zero would make a crew look quicker the
    // less carefully they measured.
    const timing = stopTiming([
      stop({ id: "a", status: PitStopStatus.COMPLETED, actualSeconds: 40 }),
      stop({ id: "b", status: PitStopStatus.COMPLETED, actualSeconds: 60 }),
      stop({ id: "c", status: PitStopStatus.COMPLETED }),
    ]);
    expect(timing.completed).toBe(3);
    expect(timing.averageSeconds).toBe(50);
    expect(timing.bestSeconds).toBe(40);
  });

  it("compares to plan only where there is a plan to compare to", () => {
    const timing = stopTiming([
      stop({
        id: "a",
        status: PitStopStatus.COMPLETED,
        plannedSeconds: 35,
        actualSeconds: 51,
      }),
      stop({ id: "b", status: PitStopStatus.COMPLETED, actualSeconds: 40 }),
    ]);
    expect(timing.deltaToPlanSeconds).toBe(16);
  });

  it("reports nothing rather than zero when no stop has run", () => {
    const timing = stopTiming([stop({ id: "a" })]);
    expect(timing.completed).toBe(0);
    expect(timing.averageSeconds).toBeNull();
    expect(timing.deltaToPlanSeconds).toBeNull();
  });
});

describe("formatStopSeconds", () => {
  it("reads the way a crew says it", () => {
    expect(formatStopSeconds(32)).toBe("32s");
    expect(formatStopSeconds(64)).toBe("1m 04s");
    expect(formatStopSeconds(120)).toBe("2m 00s");
  });

  it("is null for nothing rather than 0s", () => {
    expect(formatStopSeconds(null)).toBeNull();
    expect(formatStopSeconds(undefined)).toBeNull();
  });
});
