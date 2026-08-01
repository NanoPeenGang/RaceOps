import { AccessZone, CredentialStatus, ScanResult } from "@prisma/client";
import { ACCESS_ZONE_LABELS, isValidPass, zoneSummary } from "@/lib/credentials";

/**
 * What a gate decides, and how it says so.
 *
 * Pure, because the decision has to be identical on the marshal's phone, in
 * the scan log an hour later, and in whatever anybody reconstructs afterwards.
 * A gate tool that shows one verdict and records another is worse than no
 * record at all.
 *
 * The rule that makes this more than a lookup: a gate is checking one zone. A
 * competitor pass is perfectly valid and still must not open the pit lane, and
 * telling a marshal "valid" while they stand on the pit wall is how the wrong
 * people end up in the wrong place. So the verdict answers *this gate's*
 * question rather than "is this a real pass".
 */

export const SCAN_RESULT_LABELS: Record<ScanResult, string> = {
  ADMITTED: "Admit",
  WRONG_ZONE: "Wrong gate",
  NOT_VALID: "Do not admit",
  UNKNOWN: "Not one of ours",
};

/** Colour intent. Three states, because "no" splits into two different jobs. */
export const SCAN_RESULT_TONE: Record<ScanResult, "ok" | "warn" | "stop"> = {
  ADMITTED: "ok",
  // Amber, not red: this person is entitled to be here, just not here.
  WRONG_ZONE: "warn",
  NOT_VALID: "stop",
  UNKNOWN: "stop",
};

export interface ScannedCredential {
  status: CredentialStatus;
  zones: readonly AccessZone[];
}

export interface ScanVerdict {
  result: ScanResult;
  /** One line the marshal acts on. Always says what to do, not just what is. */
  instruction: string;
}

/**
 * The verdict for one scan.
 *
 * `credential` is null when the token matched nothing — kept as a case rather
 * than an exception because "not one of ours" is a normal outcome at a gate
 * and needs the same treatment as any other.
 *
 * `zone` is null when the tool is being used as a general identity check
 * rather than on a specific gate, in which case any valid pass admits.
 */
export function decideScan(
  credential: ScannedCredential | null,
  zone: AccessZone | null,
): ScanVerdict {
  if (!credential) {
    return {
      result: ScanResult.UNKNOWN,
      instruction:
        "No pass matches that code. It was not issued for this event — call race control before admitting.",
    };
  }

  if (!isValidPass(credential.status)) {
    return {
      result: ScanResult.NOT_VALID,
      instruction:
        credential.status === CredentialStatus.VOID
          ? "This pass has been cancelled. Do not admit."
          : "Issued but not approved yet. Send them to accreditation.",
    };
  }

  if (!zone) {
    return {
      result: ScanResult.ADMITTED,
      instruction: `Valid pass. Opens: ${zoneSummary(credential.zones) ?? "no areas recorded"}.`,
    };
  }

  if (credential.zones.includes(zone)) {
    return {
      result: ScanResult.ADMITTED,
      instruction: `Admit to ${ACCESS_ZONE_LABELS[zone]}.`,
    };
  }

  const opens = zoneSummary(credential.zones);
  return {
    result: ScanResult.WRONG_ZONE,
    instruction: opens
      ? `Valid pass, but not for ${ACCESS_ZONE_LABELS[zone]}. It opens: ${opens}.`
      : `Valid pass, but no areas are recorded on it. Check with race control before admitting to ${ACCESS_ZONE_LABELS[zone]}.`,
  };
}

/**
 * Pulls the pass token out of whatever the camera read.
 *
 * A QR encodes the full verification URL, but a marshal typing into the
 * fallback box will type — or paste — anything: the whole URL, just the token,
 * a URL with a query string a link tracker added. All of those are the same
 * pass, and refusing three of the four would send people away over a
 * formatting difference.
 */
export function extractToken(scanned: string): string | null {
  const trimmed = scanned.trim();
  if (!trimmed) return null;

  // A URL, however it got mangled: take the segment after /pass/.
  const fromUrl = /\/pass\/([A-Za-z0-9_-]+)/.exec(trimmed);
  if (fromUrl) return fromUrl[1];

  // A bare token. Constrained to the base64url alphabet the minting uses, so
  // a stray sentence does not become a database lookup.
  if (/^[A-Za-z0-9_-]{8,120}$/.test(trimmed)) return trimmed;

  return null;
}

export interface ScanCounts {
  admitted: number;
  wrongZone: number;
  notValid: number;
  unknown: number;
  total: number;
}

/** Totals for the gate's own tally, in the order they matter. */
export function countScans(
  scans: readonly { result: ScanResult }[],
): ScanCounts {
  const counts = {
    admitted: 0,
    wrongZone: 0,
    notValid: 0,
    unknown: 0,
    total: scans.length,
  };
  for (const scan of scans) {
    if (scan.result === ScanResult.ADMITTED) counts.admitted += 1;
    else if (scan.result === ScanResult.WRONG_ZONE) counts.wrongZone += 1;
    else if (scan.result === ScanResult.NOT_VALID) counts.notValid += 1;
    else counts.unknown += 1;
  }
  return counts;
}

/**
 * Whether this scan repeats one just taken.
 *
 * A camera reads the same code many times a second. Without this the log
 * fills with fifty identical rows per person and the count of who came through
 * the gate becomes meaningless. Deliberately short: somebody stepping out and
 * back in a minute later is a real second entry and should be recorded.
 */
export const DUPLICATE_WINDOW_MS = 8_000;

export function isDuplicateScan(
  token: string,
  recent: readonly { token: string | null; at: number }[],
  now = Date.now(),
): boolean {
  return recent.some(
    (scan) => scan.token === token && now - scan.at < DUPLICATE_WINDOW_MS,
  );
}
