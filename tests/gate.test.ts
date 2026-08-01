import { describe, expect, it } from "vitest";
import { AccessZone, CredentialStatus, ScanResult } from "@prisma/client";
import {
  countScans,
  decideScan,
  DUPLICATE_WINDOW_MS,
  extractToken,
  isDuplicateScan,
  SCAN_RESULT_LABELS,
  SCAN_RESULT_TONE,
} from "@/lib/gate";

const VALID = {
  status: CredentialStatus.ISSUED,
  zones: [AccessZone.PADDOCK, AccessZone.PIT_LANE],
};

describe("scan results", () => {
  it("labels and tones every result", () => {
    for (const result of Object.values(ScanResult)) {
      expect(SCAN_RESULT_LABELS[result], result).toBeTruthy();
      expect(SCAN_RESULT_TONE[result], result).toBeTruthy();
    }
  });

  it("keeps a wrong-gate amber rather than red", () => {
    // The person is entitled to be at this event, just not at this gate.
    // Colouring it like a forgery makes marshals distrust the red one.
    expect(SCAN_RESULT_TONE.WRONG_ZONE).toBe("warn");
    expect(SCAN_RESULT_TONE.NOT_VALID).toBe("stop");
    expect(SCAN_RESULT_TONE.ADMITTED).toBe("ok");
  });
});

describe("decideScan", () => {
  it("admits a valid pass at a gate it opens", () => {
    const verdict = decideScan(VALID, AccessZone.PIT_LANE);
    expect(verdict.result).toBe(ScanResult.ADMITTED);
    expect(verdict.instruction).toBe("Admit to Pit lane.");
  });

  it("turns a valid pass away from a gate it does not open", () => {
    /*
     * The whole reason this is a tool and not a lookup. A competitor pass is
     * perfectly real and must not open race control, and telling a marshal
     * "valid" while they stand there is how the wrong people get in.
     */
    const verdict = decideScan(VALID, AccessZone.RACE_CONTROL);
    expect(verdict.result).toBe(ScanResult.WRONG_ZONE);
    expect(verdict.instruction).toContain("not for Race control");
    // And says where they *can* go, so the marshal can redirect them.
    expect(verdict.instruction).toContain("Paddock · Pit lane");
  });

  it("admits any valid pass when no gate zone is set", () => {
    const verdict = decideScan(VALID, null);
    expect(verdict.result).toBe(ScanResult.ADMITTED);
    expect(verdict.instruction).toContain("Paddock · Pit lane");
  });

  it("refuses a cancelled pass, whatever the gate", () => {
    for (const zone of [AccessZone.PADDOCK, null]) {
      const verdict = decideScan(
        { ...VALID, status: CredentialStatus.VOID },
        zone,
      );
      expect(verdict.result).toBe(ScanResult.NOT_VALID);
      expect(verdict.instruction).toMatch(/cancelled/i);
    }
  });

  it("sends an unapproved pass to accreditation rather than away", () => {
    // Different problem, different fix: this person probably should be let
    // in, once somebody at the desk approves it.
    const verdict = decideScan(
      { ...VALID, status: CredentialStatus.REQUESTED },
      AccessZone.PADDOCK,
    );
    expect(verdict.result).toBe(ScanResult.NOT_VALID);
    expect(verdict.instruction).toMatch(/accreditation/i);
  });

  it("treats an unmatched code as unknown, with something to do about it", () => {
    const verdict = decideScan(null, AccessZone.PADDOCK);
    expect(verdict.result).toBe(ScanResult.UNKNOWN);
    expect(verdict.instruction).toMatch(/race control/i);
  });

  it("will not wave through a pass with no zones recorded", () => {
    // An empty zone list is missing information, not permission. Admitting on
    // it would make an unconfigured pass type into a skeleton key.
    const verdict = decideScan(
      { status: CredentialStatus.ISSUED, zones: [] },
      AccessZone.GRID,
    );
    expect(verdict.result).toBe(ScanResult.WRONG_ZONE);
    expect(verdict.instruction).toMatch(/no areas are recorded/i);
  });

  it("admits a collected pass, not only a freshly issued one", () => {
    expect(
      decideScan(
        { ...VALID, status: CredentialStatus.COLLECTED },
        AccessZone.PADDOCK,
      ).result,
    ).toBe(ScanResult.ADMITTED);
  });
});

describe("extractToken", () => {
  it("reads the token out of a scanned URL", () => {
    expect(
      extractToken("https://raceops.test/pass/xQ7_mA3pLn2ZbK9dR4tS8vWy"),
    ).toBe("xQ7_mA3pLn2ZbK9dR4tS8vWy");
  });

  it("copes with a URL a link tracker has decorated", () => {
    // All four of these are the same pass. Refusing three over a formatting
    // difference would send people away for no reason.
    expect(
      extractToken("https://raceops.test/pass/abc123def456ghi789?utm_source=x"),
    ).toBe("abc123def456ghi789");
    expect(extractToken("  http://localhost:3000/pass/abc123def456ghi789  ")).toBe(
      "abc123def456ghi789",
    );
  });

  it("accepts a bare token typed by hand", () => {
    expect(extractToken("xQ7_mA3pLn2ZbK9dR4tS8vWy")).toBe(
      "xQ7_mA3pLn2ZbK9dR4tS8vWy",
    );
  });

  it("rejects anything that is not a code, rather than querying on it", () => {
    expect(extractToken("")).toBeNull();
    expect(extractToken("   ")).toBeNull();
    expect(extractToken("hello there")).toBeNull();
    expect(extractToken("short")).toBeNull();
    // A different site's QR code is not a pass.
    expect(extractToken("https://example.com/something")).toBeNull();
  });

  it("does not mistake a sentence containing a slash for a token", () => {
    expect(extractToken("see the pass/ticket desk")).toBeNull();
  });
});

describe("isDuplicateScan", () => {
  const now = 1_000_000;

  it("suppresses the same code read again immediately", () => {
    // A camera reads eight times a second. Without this the log fills with
    // fifty identical rows per person and the head count means nothing.
    expect(
      isDuplicateScan("abc", [{ token: "abc", at: now - 500 }], now),
    ).toBe(true);
  });

  it("lets the same person back in after the window", () => {
    // Stepping out and back is a real second entry and belongs in the log.
    expect(
      isDuplicateScan(
        "abc",
        [{ token: "abc", at: now - DUPLICATE_WINDOW_MS - 1 }],
        now,
      ),
    ).toBe(false);
  });

  it("does not confuse two people scanned back to back", () => {
    expect(
      isDuplicateScan("def", [{ token: "abc", at: now - 100 }], now),
    ).toBe(false);
  });

  it("is false on an empty history", () => {
    expect(isDuplicateScan("abc", [], now)).toBe(false);
  });
});

describe("countScans", () => {
  it("tallies each outcome separately", () => {
    const counts = countScans([
      { result: ScanResult.ADMITTED },
      { result: ScanResult.ADMITTED },
      { result: ScanResult.WRONG_ZONE },
      { result: ScanResult.NOT_VALID },
      { result: ScanResult.UNKNOWN },
    ]);
    expect(counts).toEqual({
      admitted: 2,
      wrongZone: 1,
      notValid: 1,
      unknown: 1,
      total: 5,
    });
  });

  it("is all zeroes for a gate nobody has been through", () => {
    expect(countScans([])).toEqual({
      admitted: 0,
      wrongZone: 0,
      notValid: 0,
      unknown: 0,
      total: 0,
    });
  });
});
