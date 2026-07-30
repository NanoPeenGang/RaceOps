import { describe, expect, it } from "vitest";
import { TireSetStatus } from "@prisma/client";
import {
  carLabel,
  carOwner,
  carShortLabel,
  describeAllocation,
  normalizeTransponderNumber,
  resolveTransponder,
  tireAllocation,
  transponderIndex,
} from "@/lib/cars";

describe("carLabel", () => {
  it("leads with the spec and ends with the crew's own name", () => {
    expect(
      carLabel({ name: "Car 7", make: "Porsche", model: "911 GT3 R", year: 2019 }),
    ).toBe("2019 Porsche 911 GT3 R — Car 7");
  });

  it("falls back to the name alone for a car with no spec", () => {
    expect(carLabel({ name: "The red one" })).toBe("The red one");
  });

  it("uses whichever spec fields exist", () => {
    expect(carLabel({ name: "Car 4", make: "Mazda" })).toBe("Mazda — Car 4");
    expect(carLabel({ name: "Car 4", year: 1991 })).toBe("1991 — Car 4");
  });
});

describe("carShortLabel", () => {
  it("prefers make and model, falling back to the name", () => {
    expect(carShortLabel({ name: "Car 7", make: "Porsche", model: "911" })).toBe(
      "Porsche 911",
    );
    expect(carShortLabel({ name: "Car 7" })).toBe("Car 7");
  });
});

describe("carOwner", () => {
  it("reports whichever side owns it", () => {
    expect(carOwner({ teamId: "t1" })).toEqual({ kind: "team", id: "t1" });
    expect(carOwner({ ownerUserId: "u1" })).toEqual({ kind: "user", id: "u1" });
    expect(carOwner({})).toBeNull();
  });

  it("prefers the team when both are somehow set", () => {
    expect(carOwner({ teamId: "t1", ownerUserId: "u1" })).toEqual({
      kind: "team",
      id: "t1",
    });
  });
});

describe("normalizeTransponderNumber", () => {
  it("strips the punctuation timing exports add", () => {
    expect(normalizeTransponderNumber(" 1 234 567 ")).toBe("1234567");
    expect(normalizeTransponderNumber("TR-1234567")).toBe("TR1234567");
    expect(normalizeTransponderNumber("tr1234567")).toBe("TR1234567");
  });

  it("returns empty for a blank input, which callers reject", () => {
    expect(normalizeTransponderNumber("   ")).toBe("");
  });
});

describe("transponder resolution", () => {
  const index = transponderIndex([
    {
      registrationId: "reg-a",
      isPrimary: true,
      transponder: { number: "1234567" },
    },
    {
      registrationId: "reg-b",
      isPrimary: true,
      transponder: { number: "TR-9876543" },
    },
  ]);

  it("matches however the feed writes the number", () => {
    expect(resolveTransponder(index, "1 234 567")).toBe("reg-a");
    expect(resolveTransponder(index, "tr9876543")).toBe("reg-b");
    expect(resolveTransponder(index, "TR-9876543")).toBe("reg-b");
  });

  it("returns null for a unit nobody registered", () => {
    expect(resolveTransponder(index, "5555555")).toBeNull();
  });
});

describe("tireAllocation", () => {
  const sets = (...statuses: TireSetStatus[]) =>
    statuses.map((status) => ({ status }));

  it("counts allocated, fitted and returned sets against the allowance", () => {
    const allocation = tireAllocation(
      sets(
        TireSetStatus.ALLOCATED,
        TireSetStatus.FITTED,
        TireSetStatus.RETURNED,
      ),
      6,
    );
    expect(allocation.used).toBe(3);
    expect(allocation.remaining).toBe(3);
    expect(allocation.overAllowance).toBe(false);
    expect(allocation.fitted).toBe(1);
  });

  it("does not count a voided set — that is what VOID is for", () => {
    const allocation = tireAllocation(
      sets(TireSetStatus.FITTED, TireSetStatus.VOID, TireSetStatus.VOID),
      4,
    );
    expect(allocation.used).toBe(1);
    expect(allocation.voided).toBe(2);
    expect(allocation.remaining).toBe(3);
  });

  it("flags an entry over its allowance", () => {
    const allocation = tireAllocation(
      sets(
        TireSetStatus.FITTED,
        TireSetStatus.FITTED,
        TireSetStatus.RETURNED,
      ),
      2,
    );
    expect(allocation.overAllowance).toBe(true);
    expect(allocation.remaining).toBe(-1);
  });

  it("treats a null allowance as unlimited rather than zero", () => {
    const allocation = tireAllocation(sets(TireSetStatus.FITTED), null);
    expect(allocation.allowance).toBeNull();
    expect(allocation.remaining).toBeNull();
    expect(allocation.overAllowance).toBe(false);
  });
});

describe("describeAllocation", () => {
  it("reads as a count against the limit", () => {
    expect(
      describeAllocation(
        tireAllocation(
          [
            { status: TireSetStatus.FITTED },
            { status: TireSetStatus.RETURNED },
          ],
          6,
        ),
      ),
    ).toBe("2 of 6 sets used · 4 remaining");
  });

  it("says how far over the allowance an entry is", () => {
    expect(
      describeAllocation(
        tireAllocation(
          [
            { status: TireSetStatus.FITTED },
            { status: TireSetStatus.FITTED },
            { status: TireSetStatus.FITTED },
          ],
          2,
        ),
      ),
    ).toBe("3 of 2 sets used · 1 over the allowance");
  });

  it("says so when there is no limit", () => {
    expect(
      describeAllocation(tireAllocation([{ status: TireSetStatus.FITTED }], null)),
    ).toBe("1 set allocated · no limit");
  });
});
