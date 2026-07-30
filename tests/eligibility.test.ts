import { describe, expect, it } from "vitest";
import { RequirementEnforcement, RequirementKind } from "@prisma/client";
import {
  ENFORCEMENT_LABELS,
  REQUIREMENT_KIND_LABELS,
  ageAt,
  blockingFindings,
  checkEligibility,
  isEntryEligible,
  ratingFor,
  requirementsFor,
  summarizeEligibility,
  type DriverProfile,
  type Requirement,
} from "@/lib/eligibility";

const EVENT_DATE = new Date("2026-07-01T12:00:00Z");

function requirement(overrides: Partial<Requirement> = {}): Requirement {
  return {
    id: "req1",
    seriesClassId: null,
    kind: RequirementKind.CREDENTIAL,
    label: "National A licence",
    enforcement: RequirementEnforcement.BLOCKING,
    credentialKind: "FIA_LICENSE",
    simPlatform: null,
    minRating: null,
    minAge: null,
    active: true,
    ...overrides,
  };
}

function driver(overrides: Partial<DriverProfile> = {}): DriverProfile {
  return {
    userId: "u1",
    displayName: "Ann",
    dateOfBirth: null,
    credentialKinds: [],
    simStats: null,
    ...overrides,
  };
}

describe("label maps", () => {
  it("labels every requirement kind and enforcement level", () => {
    for (const kind of Object.values(RequirementKind)) {
      expect(REQUIREMENT_KIND_LABELS[kind], kind).toBeTruthy();
    }
    for (const level of Object.values(RequirementEnforcement)) {
      expect(ENFORCEMENT_LABELS[level], level).toBeTruthy();
    }
  });
});

describe("requirementsFor", () => {
  it("applies a series-wide requirement to every class", () => {
    const reqs = [requirement({ seriesClassId: null })];
    expect(requirementsFor(reqs, "gt3")).toHaveLength(1);
    expect(requirementsFor(reqs, null)).toHaveLength(1);
  });

  it("applies a class requirement only to that class", () => {
    // A fast class routinely demands a higher licence than the novice class.
    const reqs = [requirement({ id: "fast", seriesClassId: "gt3" })];
    expect(requirementsFor(reqs, "gt3")).toHaveLength(1);
    expect(requirementsFor(reqs, "novice")).toHaveLength(0);
    expect(requirementsFor(reqs, null)).toHaveLength(0);
  });

  it("ignores retired requirements", () => {
    expect(requirementsFor([requirement({ active: false })], null)).toEqual([]);
  });
});

describe("ageAt", () => {
  it("counts whole years", () => {
    expect(ageAt(new Date("2000-01-01"), new Date("2026-07-01"))).toBe(26);
  });

  it("does not count a birthday that has not happened yet", () => {
    expect(ageAt(new Date("2000-12-31"), new Date("2026-07-01"))).toBe(25);
  });

  it("counts a birthday falling on the event date", () => {
    expect(ageAt(new Date("2000-07-01"), new Date("2026-07-01"))).toBe(26);
  });
});

describe("ratingFor", () => {
  it("reads a platform rating", () => {
    expect(ratingFor({ iracing: { iRating: 3200 } }, "iracing")).toBe(3200);
  });

  it("returns null for anything unexpected rather than throwing", () => {
    // The blob is user-supplied, so it must never take down the entry list.
    expect(ratingFor(null, "iracing")).toBeNull();
    expect(ratingFor("nonsense", "iracing")).toBeNull();
    expect(ratingFor([1, 2], "iracing")).toBeNull();
    expect(ratingFor({ iracing: "fast" }, "iracing")).toBeNull();
    expect(ratingFor({ iracing: { iRating: "3200" } }, "iracing")).toBeNull();
    expect(ratingFor({ iracing: { iRating: 3200 } }, "acc")).toBeNull();
  });
});

describe("checkEligibility — credentials", () => {
  it("passes a driver holding the credential", () => {
    const findings = checkEligibility({
      requirements: [requirement()],
      seriesClassId: null,
      drivers: [driver({ credentialKinds: ["FIA_LICENSE"] })],
      waivers: [],
      on: EVENT_DATE,
    });
    expect(findings[0].state).toBe("met");
    expect(isEntryEligible(findings)).toBe(true);
  });

  it("fails a driver without it", () => {
    const findings = checkEligibility({
      requirements: [requirement()],
      seriesClassId: null,
      drivers: [driver()],
      waivers: [],
      on: EVENT_DATE,
    });
    expect(findings[0].state).toBe("not_met");
    expect(isEntryEligible(findings)).toBe(false);
  });
});

describe("checkEligibility — sim ratings", () => {
  const req = requirement({
    kind: RequirementKind.SIM_RATING,
    label: "2000 iRating",
    credentialKind: null,
    simPlatform: "iracing",
    minRating: 2000,
  });

  it("passes at or above the floor", () => {
    for (const rating of [2000, 3500]) {
      const findings = checkEligibility({
        requirements: [req],
        seriesClassId: null,
        drivers: [driver({ simStats: { iracing: { iRating: rating } } })],
        waivers: [],
      });
      expect(findings[0].state, String(rating)).toBe("met");
    }
  });

  it("fails below the floor", () => {
    const findings = checkEligibility({
      requirements: [req],
      seriesClassId: null,
      drivers: [driver({ simStats: { iracing: { iRating: 1500 } } })],
      waivers: [],
    });
    expect(findings[0].state).toBe("not_met");
    expect(findings[0].detail).toContain("1500");
  });

  it("fails when no rating is on file", () => {
    const findings = checkEligibility({
      requirements: [req],
      seriesClassId: null,
      drivers: [driver()],
      waivers: [],
    });
    expect(findings[0].state).toBe("not_met");
  });
});

describe("checkEligibility — minimum age", () => {
  const req = requirement({
    kind: RequirementKind.MIN_AGE,
    label: "16 and over",
    credentialKind: null,
    minAge: 16,
  });

  it("passes an old enough driver", () => {
    const findings = checkEligibility({
      requirements: [req],
      seriesClassId: null,
      drivers: [driver({ dateOfBirth: new Date("2005-01-01") })],
      waivers: [],
      on: EVENT_DATE,
    });
    expect(findings[0].state).toBe("met");
  });

  it("fails a driver under the minimum at the event date", () => {
    const findings = checkEligibility({
      requirements: [req],
      seriesClassId: null,
      drivers: [driver({ dateOfBirth: new Date("2012-01-01") })],
      waivers: [],
      on: EVENT_DATE,
    });
    expect(findings[0].state).toBe("not_met");
  });

  it("asks for a sign-off when no date of birth is on file", () => {
    // Unknown, not failed — an organizer can check a licence in person.
    const findings = checkEligibility({
      requirements: [req],
      seriesClassId: null,
      drivers: [driver()],
      waivers: [],
      on: EVENT_DATE,
    });
    expect(findings[0].state).toBe("needs_signoff");
  });
});

describe("checkEligibility — acknowledgements", () => {
  it("always needs a sign-off", () => {
    const findings = checkEligibility({
      requirements: [
        requirement({
          kind: RequirementKind.ACKNOWLEDGEMENT,
          label: "Drivers' briefing",
          credentialKind: null,
        }),
      ],
      seriesClassId: null,
      drivers: [driver({ credentialKinds: ["FIA_LICENSE"] })],
      waivers: [],
    });
    expect(findings[0].state).toBe("needs_signoff");
    expect(isEntryEligible(findings)).toBe(false);
  });
});

describe("checkEligibility — waivers", () => {
  it("lets an organizer sign off a requirement a driver fails", () => {
    const findings = checkEligibility({
      requirements: [requirement()],
      seriesClassId: null,
      drivers: [driver()],
      waivers: [{ requirementId: "req1", userId: "u1", granted: true }],
    });
    expect(findings[0].state).toBe("waived");
    expect(isEntryEligible(findings)).toBe(true);
  });

  it("lets an organizer refuse one a driver would otherwise pass", () => {
    const findings = checkEligibility({
      requirements: [requirement()],
      seriesClassId: null,
      drivers: [driver({ credentialKinds: ["FIA_LICENSE"] })],
      waivers: [{ requirementId: "req1", userId: "u1", granted: false }],
    });
    expect(findings[0].state).toBe("refused");
    expect(isEntryEligible(findings)).toBe(false);
  });

  it("applies a waiver only to the driver it names", () => {
    const findings = checkEligibility({
      requirements: [requirement()],
      seriesClassId: null,
      drivers: [driver(), driver({ userId: "u2", displayName: "Ben" })],
      waivers: [{ requirementId: "req1", userId: "u1", granted: true }],
    });
    expect(findings.find((f) => f.userId === "u1")?.state).toBe("waived");
    expect(findings.find((f) => f.userId === "u2")?.state).toBe("not_met");
  });
});

describe("checkEligibility — enforcement and crews", () => {
  it("never blocks on an advisory requirement", () => {
    const findings = checkEligibility({
      requirements: [
        requirement({ enforcement: RequirementEnforcement.ADVISORY }),
      ],
      seriesClassId: null,
      drivers: [driver()],
      waivers: [],
    });
    expect(findings[0].state).toBe("not_met");
    // Still reported, just not in the way.
    expect(blockingFindings(findings)).toEqual([]);
    expect(isEntryEligible(findings)).toBe(true);
  });

  it("checks each driver in an endurance crew separately", () => {
    const findings = checkEligibility({
      requirements: [requirement()],
      seriesClassId: null,
      drivers: [
        driver({ credentialKinds: ["FIA_LICENSE"] }),
        driver({ userId: "u2", displayName: "Ben" }),
        driver({
          userId: "u3",
          displayName: "Cara",
          credentialKinds: ["FIA_LICENSE"],
        }),
      ],
      waivers: [],
    });
    expect(findings).toHaveLength(3);
    // A crew can be three-quarters compliant; one driver blocks the entry.
    expect(blockingFindings(findings).map((f) => f.userId)).toEqual(["u2"]);
    expect(isEntryEligible(findings)).toBe(false);
  });

  it("yields nothing when no drivers are declared", () => {
    // Nobody to check yet — that is a line-up problem, not an eligibility one.
    expect(
      checkEligibility({
        requirements: [requirement()],
        seriesClassId: null,
        drivers: [],
        waivers: [],
      }),
    ).toEqual([]);
  });

  it("is eligible when a series sets no requirements", () => {
    const findings = checkEligibility({
      requirements: [],
      seriesClassId: null,
      drivers: [driver()],
      waivers: [],
    });
    expect(findings).toEqual([]);
    expect(isEntryEligible(findings)).toBe(true);
  });
});

describe("summarizeEligibility", () => {
  it("describes the outstanding work", () => {
    const findings = checkEligibility({
      requirements: [requirement()],
      seriesClassId: null,
      drivers: [driver(), driver({ userId: "u2", displayName: "Ben" })],
      waivers: [],
    });
    expect(summarizeEligibility(findings)).toBe(
      "2 outstanding across 2 drivers",
    );
  });

  it("reports a clean entry and a series with no rules", () => {
    expect(summarizeEligibility([])).toBe("No requirements");
    const met = checkEligibility({
      requirements: [requirement()],
      seriesClassId: null,
      drivers: [driver({ credentialKinds: ["FIA_LICENSE"] })],
      waivers: [],
    });
    expect(summarizeEligibility(met)).toBe("All requirements met");
  });
});
