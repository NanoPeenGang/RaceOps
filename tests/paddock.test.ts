import { describe, expect, it } from "vitest";
import { CredentialStatus } from "@prisma/client";
import {
  allocationClashes,
  credentialCounts,
  describeAllocation,
  eventIssuance,
  normalizePlace,
  pitBoxOverflow,
} from "@/lib/paddock";

describe("normalizePlace", () => {
  it("ignores case and collapses whitespace", () => {
    expect(normalizePlace("  Garage   4 ")).toBe("garage 4");
    expect(normalizePlace("GARAGE 4")).toBe(normalizePlace("garage 4"));
  });
});

describe("allocationClashes", () => {
  it("finds a garage handed to two entries, however it was typed", () => {
    const clashes = allocationClashes([
      { registrationId: "a", garage: "Garage 4" },
      { registrationId: "b", garage: "garage  4" },
      { registrationId: "c", garage: "Garage 5" },
    ]);
    expect(clashes).toHaveLength(1);
    expect(clashes[0].field).toBe("garage");
    expect(clashes[0].registrationIds.sort()).toEqual(["a", "b"]);
  });

  it("checks each place independently", () => {
    const clashes = allocationClashes([
      { registrationId: "a", garage: "G1", pitBox: "4" },
      { registrationId: "b", garage: "G2", pitBox: "4" },
    ]);
    expect(clashes).toHaveLength(1);
    expect(clashes[0].field).toBe("pitBox");
  });

  it("does not treat empty or missing values as a clash", () => {
    expect(
      allocationClashes([
        { registrationId: "a", garage: "" },
        { registrationId: "b", garage: "   " },
        { registrationId: "c" },
      ]),
    ).toEqual([]);
  });

  it("reports all three entries when three share a space", () => {
    const clashes = allocationClashes([
      { registrationId: "a", paddockSpace: "P14" },
      { registrationId: "b", paddockSpace: "P14" },
      { registrationId: "c", paddockSpace: "P14" },
    ]);
    expect(clashes[0].registrationIds).toHaveLength(3);
  });
});

describe("pitBoxOverflow", () => {
  it("counts distinct boxes against the venue's capacity", () => {
    expect(
      pitBoxOverflow(
        [
          { registrationId: "a", pitBox: "1" },
          { registrationId: "b", pitBox: "2" },
          { registrationId: "c", pitBox: "3" },
        ],
        2,
      ),
    ).toBe(1);
  });

  it("counts a double-booked box once", () => {
    expect(
      pitBoxOverflow(
        [
          { registrationId: "a", pitBox: "1" },
          { registrationId: "b", pitBox: "1" },
        ],
        1,
      ),
    ).toBe(0);
  });

  it("returns null when the venue records no count", () => {
    expect(pitBoxOverflow([{ registrationId: "a", pitBox: "1" }], null)).toBeNull();
    expect(
      pitBoxOverflow([{ registrationId: "a", pitBox: "1" }], undefined),
    ).toBeNull();
  });
});

describe("describeAllocation", () => {
  it("reads as the places that were actually allocated", () => {
    expect(
      describeAllocation({
        registrationId: "a",
        garage: "12",
        paddockSpace: "P14",
      }),
    ).toBe("Garage 12 · Paddock space P14");
  });

  it("returns null when nothing is allocated", () => {
    expect(describeAllocation({ registrationId: "a" })).toBeNull();
    expect(describeAllocation(null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------

const types = [
  { id: "t1", name: "Paddock", allowancePerEntry: 4, totalAvailable: 10 },
  { id: "t2", name: "Pit lane", allowancePerEntry: 2, totalAvailable: null },
];

describe("credentialCounts", () => {
  it("counts requested, issued and collected passes against the allowance", () => {
    const [paddock] = credentialCounts(types, [
      { credentialTypeId: "t1", status: CredentialStatus.REQUESTED },
      { credentialTypeId: "t1", status: CredentialStatus.ISSUED },
      { credentialTypeId: "t1", status: CredentialStatus.COLLECTED },
    ]);
    expect(paddock.used).toBe(3);
    expect(paddock.remaining).toBe(1);
    expect(paddock.overAllowance).toBe(false);
  });

  it("does not count a voided pass", () => {
    const [paddock] = credentialCounts(types, [
      { credentialTypeId: "t1", status: CredentialStatus.VOID },
      { credentialTypeId: "t1", status: CredentialStatus.VOID },
      { credentialTypeId: "t1", status: CredentialStatus.ISSUED },
    ]);
    expect(paddock.used).toBe(1);
  });

  it("flags an entry an official put over the allowance", () => {
    const [, pitLane] = credentialCounts(types, [
      { credentialTypeId: "t2", status: CredentialStatus.ISSUED },
      { credentialTypeId: "t2", status: CredentialStatus.ISSUED },
      { credentialTypeId: "t2", status: CredentialStatus.ISSUED },
    ]);
    expect(pitLane.overAllowance).toBe(true);
    expect(pitLane.remaining).toBe(-1);
  });

  it("keeps types apart", () => {
    const counts = credentialCounts(types, [
      { credentialTypeId: "t1", status: CredentialStatus.ISSUED },
    ]);
    expect(counts.map((count) => count.used)).toEqual([1, 0]);
  });
});

describe("eventIssuance", () => {
  it("tracks the event's own cap and says when a type is exhausted", () => {
    const [paddock, pitLane] = eventIssuance(
      types,
      Array.from({ length: 10 }, () => ({
        credentialTypeId: "t1",
        status: CredentialStatus.ISSUED,
      })),
    );
    expect(paddock.issued).toBe(10);
    expect(paddock.remaining).toBe(0);
    expect(paddock.exhausted).toBe(true);
    // A type with no cap is never exhausted.
    expect(pitLane.totalAvailable).toBeNull();
    expect(pitLane.exhausted).toBe(false);
  });
});
