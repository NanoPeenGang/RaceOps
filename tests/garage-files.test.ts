import { describe, expect, it } from "vitest";
import { GarageFileKind } from "@prisma/client";
import {
  GARAGE_FILE_DESCRIPTIONS,
  GARAGE_FILE_EXTENSIONS,
  GARAGE_FILE_LABELS,
  GARAGE_FILE_MAX_BYTES,
  GARAGE_FILE_ORDER,
  bestSetupsFor,
  checkGarageFile,
  formatFileSize,
  formatLapTime,
  groupByKind,
  parseLapTime,
} from "@/lib/garage-files";
import { UPLOAD_RULES, checkUpload, isAllowedType } from "@/lib/upload";
import { PURPOSES } from "@/server/trpc/routers/upload";

describe("garage file vocabulary", () => {
  it("labels and describes every kind", () => {
    for (const kind of Object.values(GarageFileKind)) {
      expect(GARAGE_FILE_LABELS[kind], kind).toBeTruthy();
      expect(GARAGE_FILE_DESCRIPTIONS[kind], kind).toBeTruthy();
      expect(GARAGE_FILE_EXTENSIONS[kind].length, kind).toBeGreaterThan(0);
    }
  });

  it("orders every kind exactly once", () => {
    expect([...GARAGE_FILE_ORDER].sort()).toEqual(
      Object.values(GarageFileKind).sort(),
    );
  });
});

describe("the garage upload purpose", () => {
  it("is one the server will actually sign", () => {
    // A purpose the client offers but the server does not sign is a file
    // picker that always fails, and only for this one feature.
    expect(PURPOSES).toContain("garage");
  });

  it("allows the size the library advertises", () => {
    expect(UPLOAD_RULES.garage.maxBytes).toBe(GARAGE_FILE_MAX_BYTES);
  });

  it("accepts the opaque types real loggers produce", () => {
    // Browsers report a MoTeC .ld or an iRacing .sto as octet-stream, so
    // rejecting it would reject most actual telemetry.
    expect(isAllowedType("garage", "application/octet-stream")).toBe(true);
    expect(isAllowedType("garage", "text/csv")).toBe(true);
    expect(isAllowedType("garage", "application/zip")).toBe(true);
  });

  it("refuses the two types that execute when opened", () => {
    // Neither is telemetry, and both run script from the bucket's origin.
    expect(isAllowedType("garage", "image/svg+xml")).toBe(false);
    expect(isAllowedType("garage", "text/html")).toBe(false);
  });

  it("rejects an over-size upload with a figure somebody can act on", () => {
    const rejection = checkUpload("garage", {
      type: "application/octet-stream",
      size: GARAGE_FILE_MAX_BYTES + 1,
    });
    expect(rejection?.reason).toBe("size");
    expect(rejection?.message).toContain("100.0 MB");
  });
});

describe("checkGarageFile", () => {
  it("refuses an empty file", () => {
    expect(checkGarageFile({ size: 0 })?.reason).toBe("empty");
  });

  it("refuses one over the cap and says the numbers", () => {
    const rejection = checkGarageFile({ size: GARAGE_FILE_MAX_BYTES + 1 });
    expect(rejection?.reason).toBe("size");
    expect(rejection?.message).toContain("100.0 MB");
  });

  it("accepts an ordinary telemetry file", () => {
    expect(checkGarageFile({ size: 18 * 1024 * 1024 })).toBeNull();
  });
});

describe("formatLapTime", () => {
  it("reads as a stopwatch does", () => {
    expect(formatLapTime(103_271)).toBe("1:43.271");
  });

  it("keeps the colon on a sub-minute lap", () => {
    // A column where some rows have a colon and some do not cannot be scanned.
    expect(formatLapTime(43_271)).toBe("0:43.271");
  });

  it("is null for nothing rather than 0:00.000", () => {
    expect(formatLapTime(null)).toBeNull();
    expect(formatLapTime(0)).toBeNull();
    expect(formatLapTime(Number.NaN)).toBeNull();
  });
});

describe("parseLapTime", () => {
  it("takes the three forms people type", () => {
    expect(parseLapTime("1:43.271")).toBe(103_271);
    expect(parseLapTime("103.271")).toBe(103_271);
    expect(parseLapTime("1:43")).toBe(103_000);
  });

  it("round-trips through formatLapTime", () => {
    expect(parseLapTime(formatLapTime(103_271)!)).toBe(103_271);
  });

  it("returns null for a half-typed value instead of guessing", () => {
    expect(parseLapTime("")).toBeNull();
    expect(parseLapTime("1:")).toBeNull();
    expect(parseLapTime("abc")).toBeNull();
  });

  it("rejects seconds that are not seconds", () => {
    expect(parseLapTime("1:75.000")).toBeNull();
    expect(parseLapTime("-5")).toBeNull();
  });
});

describe("bestSetupsFor", () => {
  const file = (
    id: string,
    over: Partial<{
      kind: GarageFileKind;
      carId: string | null;
      trackLayoutId: string | null;
      bestLapMs: number | null;
      createdAt: string;
    }> = {},
  ) => ({
    id,
    kind: GarageFileKind.SETUP,
    carId: "car1",
    trackLayoutId: "layout1",
    bestLapMs: null,
    createdAt: "2026-01-01T00:00:00Z",
    ...over,
  });

  it("is the query the whole model exists for: this car, this circuit, quickest first", () => {
    const found = bestSetupsFor(
      [
        file("slow", { bestLapMs: 105_000 }),
        file("quick", { bestLapMs: 103_000 }),
        file("elsewhere", { trackLayoutId: "layout2", bestLapMs: 90_000 }),
        file("othercar", { carId: "car2", bestLapMs: 90_000 }),
      ],
      { carId: "car1", trackLayoutId: "layout1" },
    );
    expect(found.map((row) => row.id)).toEqual(["quick", "slow"]);
  });

  it("leaves out telemetry", () => {
    const found = bestSetupsFor(
      [file("s"), file("t", { kind: GarageFileKind.TELEMETRY })],
      {},
    );
    expect(found.map((row) => row.id)).toEqual(["s"]);
  });

  it("keeps untimed setups, at the end, newest first", () => {
    // An untimed setup from last year is still the one they ran.
    const found = bestSetupsFor(
      [
        file("old", { createdAt: "2025-01-01T00:00:00Z" }),
        file("new", { createdAt: "2026-05-01T00:00:00Z" }),
        file("timed", { bestLapMs: 104_000 }),
      ],
      {},
    );
    expect(found.map((row) => row.id)).toEqual(["timed", "new", "old"]);
  });

  it("ignores a filter that is not set", () => {
    const found = bestSetupsFor([file("a", { carId: null })], {});
    expect(found).toHaveLength(1);
  });
});

describe("groupByKind", () => {
  it("puts setups before telemetry and drops empty kinds", () => {
    const groups = groupByKind([
      { kind: GarageFileKind.TELEMETRY },
      { kind: GarageFileKind.SETUP },
    ]);
    expect(groups.map((group) => group.kind)).toEqual([
      GarageFileKind.SETUP,
      GarageFileKind.TELEMETRY,
    ]);
  });
});

describe("formatFileSize", () => {
  it("scales, and says nothing for an unknown size", () => {
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(2048)).toBe("2 KB");
    expect(formatFileSize(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatFileSize(null)).toBe("—");
  });
});
