import { describe, expect, it } from "vitest";
import { InventoryUnitStatus, StockMoveKind } from "@prisma/client";
import {
  daysUntilExpiry,
  expiryState,
  EXPIRY_WARNING_DAYS,
  intoSheets,
  isAmbiguous,
  isRepeatScan,
  labelCaption,
  LABELS_PER_SHEET,
  MIN_LABEL_QR_PX,
  parseLabel,
  pruneRecent,
  RESCAN_WINDOW_MS,
  SCAN_MODE_KIND,
  SCAN_MODE_UNIT_STATUS,
  tally,
  unitIsScannable,
  unitScanIsRedundant,
} from "@/lib/part-labels";

/**
 * Scanning parts in and out.
 *
 * The two rules doing real work here are the ones whose failure is silent.
 * Re-scan suppression is the first: a camera decodes eight times a second, and
 * without it holding a phone over a label empties the shelf forty times and
 * the count is wrong by a margin nobody can reconstruct. The redundant-scan
 * rule is the second: two people scanning the same box must not book one
 * gearbox out twice.
 */

describe("reading a label", () => {
  it("reads a bin label and a part label as different things", () => {
    expect(parseLabel("https://raceops.test/parts/i/abcDEF123_-xyz")).toEqual({
      kind: "line",
      token: "abcDEF123_-xyz",
    });
    expect(parseLabel("https://raceops.test/parts/u/abcDEF123_-xyz")).toEqual({
      kind: "unit",
      token: "abcDEF123_-xyz",
    });
  });

  it("survives a link tracker adding a query string", () => {
    // A label gets photographed and pasted into a message before it gets
    // scanned, and refusing it over a formatting difference would have
    // somebody standing at a shelf retyping.
    expect(
      parseLabel("https://raceops.test/parts/u/tok_en-123?utm_source=chat"),
    ).toMatchObject({ kind: "unit", token: "tok_en-123" });
  });

  it("takes a bare token typed off the back of a label", () => {
    const token = "xQ7_mA3pLn2ZbK9dR4tS8vWy";
    expect(parseLabel(token)).toEqual({ kind: "line", token });
    // It carries no kind, so the caller has to look in both tables.
    expect(isAmbiguous(token)).toBe(true);
    expect(isAmbiguous(`https://raceops.test/parts/u/${token}`)).toBe(false);
  });

  it("refuses a stray sentence rather than making it a lookup", () => {
    for (const junk of ["", "   ", "took two pads", "https://example.test/"]) {
      expect(parseLabel(junk)).toBeNull();
    }
  });

  it("refuses a token too short to have come from the minting", () => {
    // 24 bytes of base64url is 32 characters; anything under 16 is somebody's
    // stray input, not a label.
    expect(parseLabel("abc123")).toBeNull();
  });
});

describe("direction", () => {
  it("records putting something back as a return, not a delivery", () => {
    /*
     * A part coming off a car is a different event from a delivery being
     * booked in, and flattening them would lose the distinction the ledger
     * exists to keep.
     */
    expect(SCAN_MODE_KIND.in).toBe(StockMoveKind.RETURNED);
    expect(SCAN_MODE_KIND.out).toBe(StockMoveKind.CONSUMED);
  });

  it("puts a unit where the mode says", () => {
    expect(SCAN_MODE_UNIT_STATUS.out).toBe(InventoryUnitStatus.OUT);
    expect(SCAN_MODE_UNIT_STATUS.in).toBe(InventoryUnitStatus.IN_STOCK);
  });

  it("treats scanning out something already out as no change", () => {
    // Usually two people scanning the same box. Not an error worth stopping
    // for, but it must not write a second movement.
    expect(unitScanIsRedundant(InventoryUnitStatus.OUT, "out")).toBe(true);
    expect(unitScanIsRedundant(InventoryUnitStatus.IN_STOCK, "in")).toBe(true);
    expect(unitScanIsRedundant(InventoryUnitStatus.IN_STOCK, "out")).toBe(false);
    expect(unitScanIsRedundant(InventoryUnitStatus.OUT, "in")).toBe(false);
  });

  it("never scans a retired part back onto the shelf", () => {
    expect(unitIsScannable(InventoryUnitStatus.RETIRED)).toBe(false);
    expect(unitIsScannable(InventoryUnitStatus.IN_STOCK)).toBe(true);
    expect(unitIsScannable(InventoryUnitStatus.OUT)).toBe(true);
  });
});

describe("not logging the same scan forty times", () => {
  const now = 1_700_000_000_000;

  it("ignores the same code while the window is open", () => {
    const recent = [{ token: "abc", at: now - 1_000 }];
    expect(isRepeatScan("abc", recent, now)).toBe(true);
  });

  it("lets it through once the window has passed", () => {
    const recent = [{ token: "abc", at: now - RESCAN_WINDOW_MS - 1 }];
    expect(isRepeatScan("abc", recent, now)).toBe(false);
  });

  it("does not suppress a different part scanned right after", () => {
    // Four identical bin labels off four boxes in a row is a real thing people
    // do; suppressing by time alone would lose three of them.
    const recent = [{ token: "abc", at: now - 100 }];
    expect(isRepeatScan("def", recent, now)).toBe(false);
  });

  it("is long enough to cover a phone held over a label", () => {
    // A camera decoding at 8/s reads roughly eighty times in this window.
    expect(RESCAN_WINDOW_MS).toBeGreaterThanOrEqual(10_000);
  });

  it("drops entries that can no longer suppress anything", () => {
    const recent = [
      { token: "old", at: now - RESCAN_WINDOW_MS - 1 },
      { token: "fresh", at: now - 500 },
    ];
    expect(pruneRecent(recent, now).map((scan) => scan.token)).toEqual(["fresh"]);
  });
});

describe("the session tally", () => {
  it("counts each direction separately and the lines once", () => {
    const counts = tally([
      { mode: "out", amount: 2, itemId: "pads" },
      { mode: "out", amount: 1, itemId: "pads" },
      { mode: "in", amount: 1, itemId: "wheels" },
    ]);
    expect(counts).toEqual({ out: 3, in: 1, scans: 3, lines: 2 });
  });

  it("starts at nothing", () => {
    expect(tally([])).toEqual({ out: 0, in: 0, scans: 0, lines: 0 });
  });

  it("does not net the two directions against each other", () => {
    // "Eleven out, eleven back" is a crew that loaded and unloaded a trailer;
    // netting it to zero would hide the work they are checking.
    const counts = tally([
      { mode: "out", amount: 4, itemId: "a" },
      { mode: "in", amount: 4, itemId: "a" },
    ]);
    expect(counts.out).toBe(4);
    expect(counts.in).toBe(4);
  });
});

describe("printing", () => {
  it("splits into sheets and leaves the last one short", () => {
    const labels = Array.from({ length: LABELS_PER_SHEET + 3 }, (_, i) => i);
    const sheets = intoSheets(labels);
    expect(sheets).toHaveLength(2);
    expect(sheets[0]).toHaveLength(LABELS_PER_SHEET);
    // Not padded: a team printing three onto fresh stock wants the rest blank
    // so they can run the sheet through again next time.
    expect(sheets[1]).toHaveLength(3);
  });

  it("returns nothing for nothing", () => {
    expect(intoSheets([])).toEqual([]);
  });

  it("keeps the code at the size that was proved to scan", () => {
    // Established by rasterising and decoding at print size in qr.test.ts,
    // not by guessing. Shrinking it to fit more on a page is the one change
    // that looks like an improvement and stops the labels working.
    expect(MIN_LABEL_QR_PX).toBeGreaterThanOrEqual(92);
  });

  it("prints the most identifying thing it has, and nothing if it has none", () => {
    expect(labelCaption({ serial: "GB-02", partNumber: "HB100" })).toBe("GB-02");
    expect(labelCaption({ partNumber: "HB100", location: "Rack B" })).toBe("HB100");
    expect(labelCaption({ location: "Rack B" })).toBe("Rack B");
    expect(labelCaption({})).toBeNull();
  });
});

describe("life-expiring parts", () => {
  const now = new Date("2026-06-01T00:00:00Z");

  it("flags one that is already out of date", () => {
    expect(expiryState({ expiresOn: new Date("2026-05-01") }, now)).toBe(
      "expired",
    );
  });

  it("warns far enough ahead that one can be ordered", () => {
    // Belts and extinguishers are ordered, not picked up, and a scrutineer
    // turning one down at the gate is the worst moment to find out.
    const soon = new Date(now.getTime() + 30 * 86_400_000);
    expect(expiryState({ expiresOn: soon }, now)).toBe("expiring");
    expect(daysUntilExpiry(soon, now)).toBe(30);
  });

  it("stays quiet about one that is a long way off", () => {
    const later = new Date(
      now.getTime() + (EXPIRY_WARNING_DAYS + 40) * 86_400_000,
    );
    expect(expiryState({ expiresOn: later }, now)).toBe("ok");
  });

  it("says nothing at all when no date was recorded", () => {
    // Distinct from "in date": nobody has said, and implying somebody checked
    // is how a fire bottle goes to a race out of date.
    expect(expiryState({ expiresOn: null }, now)).toBe("none");
    expect(expiryState({}, now)).toBe("none");
  });
});
