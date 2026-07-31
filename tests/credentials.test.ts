import { describe, expect, it } from "vitest";
import {
  AccessZone,
  CredentialAudience,
  CredentialStatus,
} from "@prisma/client";
import {
  ACCESS_ZONE_LABELS,
  ACCESS_ZONE_ORDER,
  AUDIENCE_DESCRIPTIONS,
  AUDIENCE_LABELS,
  holderKey,
  holderSubtitle,
  invalidReason,
  isValidPass,
  planCredentials,
  sortZones,
  zoneSummary,
  type CredentialCandidate,
  type IssuedLike,
} from "@/lib/credentials";

function candidate(
  name: string,
  overrides: Partial<CredentialCandidate> = {},
): CredentialCandidate {
  return {
    audience: CredentialAudience.DRIVER,
    name,
    userId: null,
    role: "Driver",
    registrationId: null,
    teamName: null,
    carNumber: null,
    ...overrides,
  };
}

function issued(
  credentialTypeId: string,
  overrides: Partial<IssuedLike> = {},
): IssuedLike {
  return {
    credentialTypeId,
    holderUserId: null,
    holderName: "",
    status: CredentialStatus.ISSUED,
    ...overrides,
  };
}

const DRIVER_TYPE = {
  id: "t-driver",
  name: "Driver",
  autoIssueTo: CredentialAudience.DRIVER,
};
const OFFICIAL_TYPE = {
  id: "t-official",
  name: "Official",
  autoIssueTo: CredentialAudience.ORGANIZER,
};

describe("access zones", () => {
  it("labels every zone", () => {
    for (const zone of Object.values(AccessZone)) {
      expect(ACCESS_ZONE_LABELS[zone], zone).toBeTruthy();
    }
  });

  it("orders every zone exactly once, outermost first", () => {
    expect([...ACCESS_ZONE_ORDER].sort()).toEqual(
      Object.values(AccessZone).sort(),
    );
    expect(ACCESS_ZONE_ORDER[0]).toBe(AccessZone.PADDOCK);
    expect(ACCESS_ZONE_ORDER.at(-1)).toBe(AccessZone.RACE_CONTROL);
  });

  it("sorts into reading order regardless of how they were stored", () => {
    expect(
      sortZones([AccessZone.GRID, AccessZone.PADDOCK, AccessZone.PIT_LANE]),
    ).toEqual([AccessZone.PADDOCK, AccessZone.PIT_LANE, AccessZone.GRID]);
  });

  it("deduplicates", () => {
    expect(sortZones([AccessZone.GRID, AccessZone.GRID])).toEqual([
      AccessZone.GRID,
    ]);
  });

  it("summarises in one line", () => {
    expect(
      zoneSummary([AccessZone.GRID, AccessZone.PADDOCK, AccessZone.PIT_LANE]),
    ).toBe("Paddock · Pit lane · Grid");
  });

  it("is null for a pass with no zones, not an empty string", () => {
    // A blank where a gate marshal expects a list reads as "no restrictions",
    // which is the opposite of what an unconfigured pass means.
    expect(zoneSummary([])).toBeNull();
  });
});

describe("audiences", () => {
  it("labels and describes every audience", () => {
    for (const audience of Object.values(CredentialAudience)) {
      expect(AUDIENCE_LABELS[audience], audience).toBeTruthy();
      expect(AUDIENCE_DESCRIPTIONS[audience], audience).toBeTruthy();
    }
  });
});

describe("isValidPass", () => {
  it("admits an issued or collected pass", () => {
    // Plenty of events hand passes out without ever marking them collected,
    // and a scan reading "invalid" for a badge the event printed would teach
    // marshals to ignore the result.
    expect(isValidPass(CredentialStatus.ISSUED)).toBe(true);
    expect(isValidPass(CredentialStatus.COLLECTED)).toBe(true);
  });

  it("refuses a requested or voided pass", () => {
    expect(isValidPass(CredentialStatus.REQUESTED)).toBe(false);
    expect(isValidPass(CredentialStatus.VOID)).toBe(false);
  });

  it("explains a refusal in words the person can act on", () => {
    expect(invalidReason(CredentialStatus.VOID)).toMatch(/do not admit/i);
    expect(invalidReason(CredentialStatus.REQUESTED)).toMatch(/accreditation/i);
    expect(invalidReason(CredentialStatus.ISSUED)).toBeNull();
  });
});

describe("holderKey", () => {
  it("prefers the account, so two people with one name both get a pass", () => {
    expect(holderKey({ userId: "u1", name: "Sam Smith" })).not.toBe(
      holderKey({ userId: "u2", name: "Sam Smith" }),
    );
  });

  it("matches a person across a display-name change", () => {
    expect(holderKey({ userId: "u1", name: "Sam Smith" })).toBe(
      holderKey({ holderUserId: "u1", holderName: "Samantha Smith" }),
    );
  });

  it("falls back to a normalised name for crew with no account", () => {
    expect(holderKey({ name: "  Sam   Smith " })).toBe(
      holderKey({ holderName: "sam smith" }),
    );
  });
});

describe("planCredentials", () => {
  it("issues one pass per candidate whose audience has a type", () => {
    const plan = planCredentials(
      [candidate("Alex", { userId: "u1" }), candidate("Blake", { userId: "u2" })],
      [DRIVER_TYPE],
      [],
    );
    expect(plan.toIssue).toHaveLength(2);
    expect(plan.toIssue[0].credentialTypeId).toBe("t-driver");
    expect(plan.alreadyHeld).toBe(0);
  });

  it("skips anyone who already holds that pass", () => {
    const plan = planCredentials(
      [candidate("Alex", { userId: "u1" })],
      [DRIVER_TYPE],
      [issued("t-driver", { holderUserId: "u1" })],
    );
    expect(plan.toIssue).toEqual([]);
    expect(plan.alreadyHeld).toBe(1);
  });

  it("re-issues to somebody whose pass was voided", () => {
    // A driver whose pass was cancelled and who is back on the entry list
    // needs a new one. Counting a void as held is how they end up at a gate
    // on Saturday morning with nothing.
    const plan = planCredentials(
      [candidate("Alex", { userId: "u1" })],
      [DRIVER_TYPE],
      [issued("t-driver", { holderUserId: "u1", status: CredentialStatus.VOID })],
    );
    expect(plan.toIssue).toHaveLength(1);
  });

  it("counts a requested pass as held, so a sweep does not duplicate it", () => {
    const plan = planCredentials(
      [candidate("Alex", { userId: "u1" })],
      [DRIVER_TYPE],
      [
        issued("t-driver", {
          holderUserId: "u1",
          status: CredentialStatus.REQUESTED,
        }),
      ],
    );
    expect(plan.toIssue).toEqual([]);
  });

  it("does not double-issue within a single run", () => {
    // Somebody driving for two entries appears twice in the candidate list.
    const plan = planCredentials(
      [candidate("Alex", { userId: "u1" }), candidate("Alex", { userId: "u1" })],
      [DRIVER_TYPE],
      [],
    );
    expect(plan.toIssue).toHaveLength(1);
    expect(plan.alreadyHeld).toBe(1);
  });

  it("lists candidates that match no type instead of dropping them", () => {
    // This is the failure that would otherwise be silent: a driver who gets
    // nothing and appears in no error message.
    const plan = planCredentials(
      [
        candidate("Alex", { userId: "u1" }),
        candidate("Robin", {
          userId: "u2",
          audience: CredentialAudience.VOLUNTEER,
        }),
      ],
      [DRIVER_TYPE],
      [],
    );
    expect(plan.toIssue).toHaveLength(1);
    expect(plan.unmatched.map((c) => c.name)).toEqual(["Robin"]);
  });

  it("ignores a type with no audience set", () => {
    const plan = planCredentials(
      [candidate("Alex", { userId: "u1" })],
      [{ id: "t-guest", name: "Guest", autoIssueTo: null }],
      [],
    );
    expect(plan.toIssue).toEqual([]);
    expect(plan.unmatched).toHaveLength(1);
  });

  it("uses one type per audience when two claim the same people", () => {
    // Two types both set to DRIVER would otherwise give everyone two passes,
    // which is worse than quietly ignoring the second.
    const plan = planCredentials(
      [candidate("Alex", { userId: "u1" })],
      [DRIVER_TYPE, { ...DRIVER_TYPE, id: "t-driver-2", name: "Driver B" }],
      [],
    );
    expect(plan.toIssue).toHaveLength(1);
    expect(plan.toIssue[0].credentialTypeId).toBe("t-driver");
  });

  it("routes each audience to its own type", () => {
    const plan = planCredentials(
      [
        candidate("Alex", { userId: "u1" }),
        candidate("Chris", {
          userId: "u2",
          audience: CredentialAudience.ORGANIZER,
        }),
      ],
      [DRIVER_TYPE, OFFICIAL_TYPE],
      [],
    );
    expect(
      plan.toIssue.map((entry) => entry.credentialTypeName).sort(),
    ).toEqual(["Driver", "Official"]);
  });

  it("holds a pass against the type, not just the person", () => {
    // Holding a driver pass must not stop somebody also getting an official
    // pass — a clerk of the course who is also racing needs both.
    const plan = planCredentials(
      [
        candidate("Alex", { userId: "u1" }),
        candidate("Alex", {
          userId: "u1",
          audience: CredentialAudience.ORGANIZER,
        }),
      ],
      [DRIVER_TYPE, OFFICIAL_TYPE],
      [issued("t-driver", { holderUserId: "u1" })],
    );
    expect(plan.toIssue).toHaveLength(1);
    expect(plan.toIssue[0].credentialTypeId).toBe("t-official");
  });

  it("copes with an empty event", () => {
    expect(planCredentials([], [], [])).toEqual({
      toIssue: [],
      alreadyHeld: 0,
      unmatched: [],
    });
  });
});

describe("holderSubtitle", () => {
  it("leads with the car number, which is what a marshal is looking at", () => {
    expect(
      holderSubtitle({ carNumber: "24", teamName: "Apex", role: "Mechanic" }),
    ).toBe("#24 · Apex · Mechanic");
  });

  it("skips what is missing", () => {
    expect(
      holderSubtitle({ carNumber: null, teamName: null, role: "Marshal" }),
    ).toBe("Marshal");
  });

  it("is null when nothing is known", () => {
    expect(
      holderSubtitle({ carNumber: null, teamName: null, role: null }),
    ).toBeNull();
  });
});
