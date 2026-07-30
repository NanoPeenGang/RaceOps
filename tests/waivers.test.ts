import { describe, expect, it } from "vitest";
import { WaiverAudience } from "@prisma/client";
import {
  ageAt,
  audienceCovers,
  hasSigned,
  isAcceptableSignature,
  outstandingWaivers,
  signingCapacity,
  waiverStatuses,
  type SignatureLike,
  type WaiverLike,
} from "@/lib/waivers";

const waiver = (overrides: Partial<WaiverLike> = {}): WaiverLike => ({
  id: "w1",
  title: "Indemnity",
  version: 1,
  audience: WaiverAudience.ALL_PARTICIPANTS,
  required: true,
  active: true,
  ...overrides,
});

const signature = (overrides: Partial<SignatureLike> = {}): SignatureLike => ({
  waiverId: "w1",
  waiverVersion: 1,
  signerUserId: "u1",
  signedName: "Sam Driver",
  ...overrides,
});

describe("audienceCovers", () => {
  it("covers drivers and crew under ALL_PARTICIPANTS, but not volunteers", () => {
    expect(audienceCovers(WaiverAudience.ALL_PARTICIPANTS, "driver")).toBe(true);
    expect(audienceCovers(WaiverAudience.ALL_PARTICIPANTS, "crew")).toBe(true);
    // Volunteers work for the organizer, not an entrant, and are covered by
    // their own document.
    expect(audienceCovers(WaiverAudience.ALL_PARTICIPANTS, "volunteer")).toBe(
      false,
    );
    expect(audienceCovers(WaiverAudience.ALL_PARTICIPANTS, "pass_holder")).toBe(
      false,
    );
  });

  it("narrows to exactly one role for the specific audiences", () => {
    expect(audienceCovers(WaiverAudience.DRIVERS, "driver")).toBe(true);
    expect(audienceCovers(WaiverAudience.DRIVERS, "crew")).toBe(false);
    expect(audienceCovers(WaiverAudience.VOLUNTEERS, "volunteer")).toBe(true);
    expect(audienceCovers(WaiverAudience.CREDENTIAL_HOLDERS, "pass_holder")).toBe(
      true,
    );
  });
});

describe("hasSigned", () => {
  it("only counts a signature against the current version", () => {
    expect(hasSigned(waiver(), [signature()], "u1")).toBe(true);
    expect(hasSigned(waiver({ version: 2 }), [signature()], "u1")).toBe(false);
  });

  it("does not accept somebody else's signature", () => {
    expect(hasSigned(waiver(), [signature({ signerUserId: "u2" })], "u1")).toBe(
      false,
    );
  });
});

describe("waiverStatuses", () => {
  it("flags a signature that covers only an older version", () => {
    const [status] = waiverStatuses(
      [waiver({ version: 2 })],
      [signature({ waiverVersion: 1 })],
      "u1",
      "driver",
    );
    expect(status.signed).toBe(false);
    expect(status.signedOldVersion).toBe(true);
  });

  it("does not claim an old version for someone who never signed", () => {
    const [status] = waiverStatuses(
      [waiver({ version: 2 })],
      [],
      "u1",
      "driver",
    );
    expect(status.signed).toBe(false);
    expect(status.signedOldVersion).toBe(false);
  });

  it("skips waivers that do not apply to the role", () => {
    const statuses = waiverStatuses(
      [waiver({ audience: WaiverAudience.VOLUNTEERS })],
      [],
      "u1",
      "driver",
    );
    expect(statuses).toEqual([]);
  });

  it("skips retired waivers", () => {
    expect(
      waiverStatuses([waiver({ active: false })], [], "u1", "driver"),
    ).toEqual([]);
  });
});

describe("outstandingWaivers", () => {
  it("lists only required, unsigned waivers", () => {
    const statuses = waiverStatuses(
      [
        waiver({ id: "a", required: true }),
        waiver({ id: "b", required: false }),
        waiver({ id: "c", required: true }),
      ],
      [signature({ waiverId: "c" })],
      "u1",
      "driver",
    );
    expect(outstandingWaivers(statuses).map((s) => s.waiverId)).toEqual(["a"]);
  });
});

describe("isAcceptableSignature", () => {
  it("accepts the many forms people actually sign in", () => {
    expect(isAcceptableSignature("Roberta Smith-Okonkwo")).toBe(true);
    expect(isAcceptableSignature("R. Smith")).toBe(true);
    expect(isAcceptableSignature("Bob")).toBe(true);
    expect(isAcceptableSignature("李明")).toBe(true);
  });

  it("rejects a click-through with nothing typed", () => {
    expect(isAcceptableSignature("")).toBe(false);
    expect(isAcceptableSignature("   ")).toBe(false);
    expect(isAcceptableSignature("x")).toBe(false);
    expect(isAcceptableSignature("--")).toBe(false);
  });
});

describe("signingCapacity", () => {
  const at = new Date(2026, 5, 1);

  it("lets anyone sign when the waiver sets no age", () => {
    expect(signingCapacity({ minSigningAge: null }, null, at)).toBe("self");
  });

  it("requires a guardian below the age", () => {
    expect(
      signingCapacity({ minSigningAge: 18 }, new Date(2012, 0, 1), at),
    ).toBe("guardian");
  });

  it("lets an adult sign for themselves", () => {
    expect(
      signingCapacity({ minSigningAge: 18 }, new Date(2000, 0, 1), at),
    ).toBe("self");
  });

  it("asks rather than assuming when the date of birth is unknown", () => {
    expect(signingCapacity({ minSigningAge: 18 }, null, at)).toBe("unknown");
  });

  it("counts the birthday itself as reaching the age", () => {
    expect(
      signingCapacity(
        { minSigningAge: 18 },
        new Date(2008, 5, 1),
        new Date(2026, 5, 1),
      ),
    ).toBe("self");
    expect(
      signingCapacity(
        { minSigningAge: 18 },
        new Date(2008, 5, 2),
        new Date(2026, 5, 1),
      ),
    ).toBe("guardian");
  });
});

describe("ageAt", () => {
  it("counts whole years, not calendar-year differences", () => {
    expect(ageAt(new Date(2000, 11, 31), new Date(2026, 0, 1))).toBe(25);
    expect(ageAt(new Date(2000, 0, 1), new Date(2026, 0, 1))).toBe(26);
  });
});
