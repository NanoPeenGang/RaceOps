import { InventoryUnitStatus, StockMoveKind } from "@prisma/client";

/**
 * Scanning parts in and out of the trailer.
 *
 * The workflow this is built around is somebody standing at a shelf with a
 * phone in one hand and a gearbox in the other. That constrains almost every
 * decision here: the mode is set once and then twenty things are scanned, a
 * scan commits immediately rather than opening a form, and the correction for
 * getting it wrong is one tap rather than a trip to a ledger screen.
 *
 * Everything is pure so the station, the router and the tests share one set of
 * rules — a stock rule enforced only in the UI is not a rule, it is a habit.
 */

// -- Two kinds of label ------------------------------------------------------

/**
 * What a scanned code turned out to be.
 *
 * A stock line and a physical part are different things and get different
 * labels, because printing eight identical labels for eight sets of pads would
 * be theatre: scanning any one of them means exactly what scanning the shelf
 * means. Per-part labels earn their place only where the part has an identity
 * worth following — a gearbox, a fire bottle with a date on it.
 */
export type LabelKind = "line" | "unit";

export const LABEL_KIND_LABELS: Record<LabelKind, string> = {
  line: "Bin label",
  unit: "Part label",
};

/** URL path each kind of label encodes. */
export const LABEL_PATHS: Record<LabelKind, string> = {
  line: "/parts/i",
  unit: "/parts/u",
};

export interface ParsedLabel {
  kind: LabelKind;
  token: string;
}

/**
 * Pulls a label out of whatever the camera read.
 *
 * A QR encodes a full URL, but the manual box takes whatever somebody types or
 * pastes: the whole URL, a URL a link tracker added a query string to, or the
 * bare token off the back of a label. Those are all the same part, and
 * refusing three of the four would have people standing at a shelf retyping.
 *
 * The manual box is not a developer fallback. It is what works when a lens is
 * wet, a label is under a scratched sleeve, or a phone's autofocus gives up in
 * the flat grey light of a trailer — and a scan tool with no way to type the
 * code in is a scan tool that stops working in the rain.
 */
export function parseLabel(scanned: string): ParsedLabel | null {
  const trimmed = scanned.trim();
  if (!trimmed) return null;

  const fromUrl = /\/parts\/([iu])\/([A-Za-z0-9_-]+)/.exec(trimmed);
  if (fromUrl) {
    return {
      kind: fromUrl[1] === "u" ? "unit" : "line",
      token: fromUrl[2]!,
    };
  }

  /*
   * A bare token has no kind in it, so it cannot be resolved here — the caller
   * looks it up against both tables. Constrained to the base64url alphabet the
   * minting draws from so a stray sentence does not become two queries.
   */
  if (/^[A-Za-z0-9_-]{16,120}$/.test(trimmed)) {
    return { kind: "line", token: trimmed };
  }

  return null;
}

/** Whether a scan needs looking up against both tables. */
export function isAmbiguous(scanned: string): boolean {
  return parseLabel(scanned) !== null && !/\/parts\/[iu]\//.test(scanned);
}

// -- Direction ---------------------------------------------------------------

/**
 * Which way the shelf is moving.
 *
 * Set once for a run of scans rather than chosen per part. Somebody loading a
 * trailer is doing one of these twenty times, and asking after every scan is
 * the difference between a tool that gets used at 6am and one that does not.
 */
export type ScanMode = "out" | "in";

export const SCAN_MODE_LABELS: Record<ScanMode, string> = {
  out: "Taking out",
  in: "Putting back",
};

/**
 * The ledger entry a scan in this mode produces.
 *
 * `in` is RETURNED rather than RECEIVED on purpose. A delivery being booked in
 * is a different event from a part coming back off a car, and flattening them
 * would lose the distinction the ledger exists to keep — RECEIVED stays for
 * the goods-in path, where somebody is looking at a packing list.
 */
export const SCAN_MODE_KIND: Record<ScanMode, StockMoveKind> = {
  out: StockMoveKind.CONSUMED,
  in: StockMoveKind.RETURNED,
};

/** Where a unit ends up after a scan in this mode. */
export const SCAN_MODE_UNIT_STATUS: Record<ScanMode, InventoryUnitStatus> = {
  out: InventoryUnitStatus.OUT,
  in: InventoryUnitStatus.IN_STOCK,
};

export const UNIT_STATUS_LABELS: Record<InventoryUnitStatus, string> = {
  IN_STOCK: "On the shelf",
  OUT: "Signed out",
  RETIRED: "Retired",
};

/**
 * Whether a unit scan in this mode changes anything.
 *
 * Scanning something out that is already out is not an error worth stopping
 * for — it usually means two people scanned the same box — but it must not
 * write a second movement, or one gearbox leaves the shelf twice and the count
 * goes wrong in a way nobody can unpick later.
 */
export function unitScanIsRedundant(
  status: InventoryUnitStatus,
  mode: ScanMode,
): boolean {
  return status === SCAN_MODE_UNIT_STATUS[mode];
}

/** A retired part is history and never comes back through the scanner. */
export function unitIsScannable(status: InventoryUnitStatus): boolean {
  return status !== InventoryUnitStatus.RETIRED;
}

// -- Not logging the same scan forty times -----------------------------------

/**
 * How long the same code is ignored after it is read.
 *
 * A camera decodes eight times a second. Without this, holding a phone over a
 * label for five seconds books the same gearbox out forty times, and the count
 * is then wrong by a margin nobody can reconstruct.
 *
 * Longer than the gate's eight seconds because the failure is worse. A gate
 * double-count inflates a head count; this one silently empties a shelf. Ten
 * seconds is still short enough that scanning four identical bin labels off
 * four boxes in a row works, which is a real thing people do.
 */
export const RESCAN_WINDOW_MS = 10_000;

export interface RecentScan {
  token: string;
  at: number;
}

export function isRepeatScan(
  token: string,
  recent: readonly RecentScan[],
  now = Date.now(),
): boolean {
  return recent.some(
    (scan) => scan.token === token && now - scan.at < RESCAN_WINDOW_MS,
  );
}

/** Drops entries that can no longer suppress anything. */
export function pruneRecent(
  recent: readonly RecentScan[],
  now = Date.now(),
): RecentScan[] {
  return recent.filter((scan) => now - scan.at < RESCAN_WINDOW_MS);
}

// -- The tally ---------------------------------------------------------------

export interface ScanRecord {
  mode: ScanMode;
  /** How many units the scan moved. Always positive. */
  amount: number;
  itemId: string;
}

export interface ScanTally {
  out: number;
  in: number;
  scans: number;
  /** Distinct lines touched — what somebody checks against the trailer. */
  lines: number;
}

/**
 * The running total for a scanning session.
 *
 * Shown constantly rather than at the end. The check somebody actually does is
 * "I put eleven things in the trailer and the screen says eleven", and that
 * only works if the number is in front of them while they are still standing
 * next to the shelf.
 */
export function tally(records: readonly ScanRecord[]): ScanTally {
  const lines = new Set<string>();
  let out = 0;
  let taken = 0;
  for (const record of records) {
    lines.add(record.itemId);
    if (record.mode === "out") out += record.amount;
    else taken += record.amount;
  }
  return { out, in: taken, scans: records.length, lines: lines.size };
}

// -- Printing ----------------------------------------------------------------

/**
 * The smallest a label's code may be printed.
 *
 * 92px on the sheet, roughly 24mm on paper — the floor the credential badge
 * work established by rasterising and decoding at print size rather than by
 * guessing. Below it a phone camera starts failing in poor light, which is
 * precisely where these get used.
 */
export const MIN_LABEL_QR_PX = 92;

/**
 * Labels per sheet.
 *
 * Three across matches the common 63.5mm address-label stock, so a team can
 * print onto peel-off sheets they can already buy rather than onto paper they
 * then have to cut up and tape to a bin.
 */
export const LABELS_PER_ROW = 3;
export const LABEL_ROWS_PER_SHEET = 8;
export const LABELS_PER_SHEET = LABELS_PER_ROW * LABEL_ROWS_PER_SHEET;

/**
 * Splits labels into printed sheets.
 *
 * A partial last sheet is returned as it is rather than padded: a team
 * printing seven labels onto a fresh sheet of stock wants the other seventeen
 * left blank so they can use them next time.
 */
export function intoSheets<T>(
  labels: readonly T[],
  perSheet = LABELS_PER_SHEET,
): T[][] {
  const sheets: T[][] = [];
  for (let index = 0; index < labels.length; index += perSheet) {
    sheets.push(labels.slice(index, index + perSheet));
  }
  return sheets;
}

/**
 * What goes on the label besides the code.
 *
 * Deliberately short. A 63mm label at arm's length in a dim trailer holds a
 * name and one identifying line before it becomes unreadable, and a label
 * nobody can read without their glasses gets scanned instead of read — which
 * is fine until the phone is flat.
 */
export function labelCaption(part: {
  partNumber?: string | null;
  location?: string | null;
  serial?: string | null;
}): string | null {
  return part.serial ?? part.partNumber ?? part.location ?? null;
}

// -- Expiry ------------------------------------------------------------------

/**
 * How far ahead a life-expiring part is worth warning about.
 *
 * Ninety days, because the things this applies to — belts, extinguishers, fuel
 * cells — are ordered rather than picked up, and a scrutineer turning one down
 * at the gate is the worst possible moment to discover the date.
 */
export const EXPIRY_WARNING_DAYS = 90;

export function daysUntilExpiry(expiresOn: Date, now = new Date()): number {
  return Math.ceil((expiresOn.getTime() - now.getTime()) / 86_400_000);
}

export type ExpiryState = "expired" | "expiring" | "ok" | "none";

export function expiryState(
  unit: { expiresOn?: Date | null },
  now = new Date(),
): ExpiryState {
  if (!unit.expiresOn) return "none";
  const days = daysUntilExpiry(unit.expiresOn, now);
  if (days < 0) return "expired";
  return days <= EXPIRY_WARNING_DAYS ? "expiring" : "ok";
}

export const EXPIRY_STATE_LABELS: Record<ExpiryState, string> = {
  expired: "Out of date",
  expiring: "Expiring soon",
  ok: "In date",
  none: "No expiry recorded",
};
