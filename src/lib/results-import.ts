import { ResultStatus } from "@prisma/client";
import { parseLapTime } from "@/lib/lap-time";

/**
 * Bulk results import (spec Phase 3 fallback): organizers paste a CSV or JSON
 * export from their timing system or sim platform instead of typing every
 * classification by hand.
 *
 * Everything here is pure — parsing, header mapping, validation and matching
 * entries — so the preview the organizer sees is produced by exactly the same
 * code that performs the write.
 */

// ---------------------------------------------------------------------------
// CSV parsing (RFC 4180: quoted fields, embedded commas/newlines, "" escapes)
// ---------------------------------------------------------------------------

export function parseDelimited(text: string): string[][] {
  // Strip a UTF-8 BOM — spreadsheet exports routinely carry one.
  const input = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  while (i < input.length) {
    const char = input[i];

    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (char === "," || char === "\t" || char === ";") {
      row.push(field);
      field = "";
      i += 1;
      continue;
    }
    if (char === "\r") {
      i += 1;
      continue;
    }
    if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += 1;
      continue;
    }
    field += char;
    i += 1;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // Drop trailing blank lines.
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

// ---------------------------------------------------------------------------
// Header mapping
// ---------------------------------------------------------------------------

/** Normalizes a header cell: lowercase, alphanumeric only. */
function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "");
}

type FieldName =
  | "carNumber"
  | "competitor"
  | "position"
  | "status"
  | "laps"
  | "bestLap"
  | "fastestLap"
  | "points";

/** Accepted spellings per field, covering common timing/sim exports. */
const HEADER_ALIASES: Record<FieldName, string[]> = {
  carNumber: ["car", "carno", "carnumber", "no", "num", "number", "kart"],
  competitor: [
    "team",
    "teamname",
    "driver",
    "drivername",
    "name",
    "entrant",
    "competitor",
  ],
  position: ["pos", "position", "finish", "finishpos", "finishingposition", "place", "rank"],
  status: ["status", "outreason", "reason", "classification", "result"],
  laps: ["laps", "lapscompleted", "lapscomplete", "lapcount", "completedlaps"],
  bestLap: [
    "bestlap",
    "bestlaptime",
    "fastestlaptime",
    "besttime",
    "fastest",
    "bestlaptimems",
  ],
  fastestLap: ["fl", "fastestlapbonus", "hasfastestlap", "fastestlapflag"],
  points: ["points", "pointsoverride", "pts"],
};

export type HeaderMap = Partial<Record<FieldName, number>>;

export function mapHeaders(headerRow: string[]): HeaderMap {
  const map: HeaderMap = {};
  headerRow.forEach((raw, index) => {
    const normalized = normalizeHeader(raw);
    if (!normalized) {
      // "#" is a common car-number header but normalizes to nothing.
      if (raw.trim() === "#" && map.carNumber === undefined) {
        map.carNumber = index;
      }
      return;
    }
    for (const [field, aliases] of Object.entries(HEADER_ALIASES) as [
      FieldName,
      string[],
    ][]) {
      if (map[field] !== undefined) continue;
      if (aliases.includes(normalized)) {
        map[field] = index;
        return;
      }
    }
  });
  return map;
}

// ---------------------------------------------------------------------------
// Row interpretation
// ---------------------------------------------------------------------------

/** Maps free-text status values onto our result statuses. */
export function parseResultStatus(raw: string | undefined): ResultStatus {
  const value = (raw ?? "").trim().toLowerCase().replace(/[^a-z]/g, "");
  if (!value) return ResultStatus.FINISHED;
  if (["dnf", "retired", "ret", "out", "mechanical", "accident"].includes(value)) {
    return ResultStatus.DNF;
  }
  if (["dns", "didnotstart", "notstarted", "withdrawn"].includes(value)) {
    return ResultStatus.DNS;
  }
  if (["dsq", "disqualified", "dq", "excluded"].includes(value)) {
    return ResultStatus.DSQ;
  }
  return ResultStatus.FINISHED;
}

function parseBoolean(raw: string | undefined): boolean {
  const value = (raw ?? "").trim().toLowerCase();
  return ["1", "true", "yes", "y", "x", "fl"].includes(value);
}

function parseInteger(raw: string | undefined): number | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  const parsed = Number(value.replace(/[^0-9-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

export interface ParsedResultRow {
  /** 1-based row number in the source, for error messages. */
  rowNumber: number;
  carNumber: string | null;
  competitor: string | null;
  position: number | null;
  status: ResultStatus;
  laps: number | null;
  bestLapMs: number | null;
  fastestLap: boolean;
  pointsOverride: number | null;
}

export interface ImportIssue {
  rowNumber: number;
  message: string;
}

export interface ParsedImport {
  rows: ParsedResultRow[];
  issues: ImportIssue[];
}

/**
 * Parses a CSV/TSV or JSON-array payload into result rows.
 * Rows that cannot be interpreted are reported as issues rather than
 * silently dropped.
 */
export function parseResultsImport(text: string): ParsedImport {
  const trimmed = text.trim();
  if (!trimmed) return { rows: [], issues: [] };

  return trimmed.startsWith("[")
    ? parseJsonImport(trimmed)
    : parseCsvImport(trimmed);
}

function parseJsonImport(text: string): ParsedImport {
  const issues: ImportIssue[] = [];
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return { rows: [], issues: [{ rowNumber: 0, message: "Invalid JSON." }] };
  }
  if (!Array.isArray(payload)) {
    return {
      rows: [],
      issues: [{ rowNumber: 0, message: "Expected a JSON array of results." }],
    };
  }

  const rows: ParsedResultRow[] = [];
  payload.forEach((item, index) => {
    const rowNumber = index + 1;
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      issues.push({ rowNumber, message: "Expected an object." });
      return;
    }
    // Reuse the CSV header mapping by treating object keys as headers.
    const record = item as Record<string, unknown>;
    const keys = Object.keys(record);
    const map = mapHeaders(keys);
    const values = keys.map((key) =>
      record[key] === null || record[key] === undefined
        ? ""
        : String(record[key]),
    );
    const parsed = interpretRow(values, map, rowNumber, issues);
    if (parsed) rows.push(parsed);
  });
  return { rows, issues };
}

function parseCsvImport(text: string): ParsedImport {
  const issues: ImportIssue[] = [];
  const table = parseDelimited(text);
  if (table.length === 0) return { rows: [], issues };

  const map = mapHeaders(table[0]);
  const recognized = Object.keys(map).length;
  if (recognized === 0) {
    return {
      rows: [],
      issues: [
        {
          rowNumber: 1,
          message:
            "No recognizable columns. Expected a header row containing at least a car number or competitor name, plus a position.",
        },
      ],
    };
  }
  if (map.carNumber === undefined && map.competitor === undefined) {
    return {
      rows: [],
      issues: [
        {
          rowNumber: 1,
          message:
            "Results need a car number or competitor column so entries can be matched.",
        },
      ],
    };
  }

  const rows: ParsedResultRow[] = [];
  for (let i = 1; i < table.length; i++) {
    const parsed = interpretRow(table[i], map, i + 1, issues);
    if (parsed) rows.push(parsed);
  }
  return { rows, issues };
}

function interpretRow(
  cells: string[],
  map: HeaderMap,
  rowNumber: number,
  issues: ImportIssue[],
): ParsedResultRow | null {
  const at = (field: FieldName): string | undefined => {
    const index = map[field];
    return index === undefined ? undefined : cells[index];
  };

  const carNumber = (at("carNumber") ?? "").trim() || null;
  const competitor = (at("competitor") ?? "").trim() || null;
  if (!carNumber && !competitor) {
    issues.push({
      rowNumber,
      message: "No car number or competitor name — cannot match an entry.",
    });
    return null;
  }

  const status = parseResultStatus(at("status"));
  const position = parseInteger(at("position"));
  if (position !== null && position <= 0) {
    issues.push({ rowNumber, message: "Finishing position must be positive." });
    return null;
  }
  if (status === ResultStatus.FINISHED && position === null) {
    issues.push({
      rowNumber,
      message: "A classified finish needs a finishing position.",
    });
    return null;
  }

  const bestLapRaw = at("bestLap");
  const bestLapMs = bestLapRaw ? parseLapTime(bestLapRaw) : null;
  if (bestLapRaw && bestLapRaw.trim() && bestLapMs === null) {
    issues.push({
      rowNumber,
      message: `Could not read the lap time "${bestLapRaw.trim()}".`,
    });
  }

  return {
    rowNumber,
    carNumber,
    competitor,
    position,
    status,
    laps: parseInteger(at("laps")),
    bestLapMs,
    fastestLap: parseBoolean(at("fastestLap")),
    pointsOverride: parseInteger(at("points")),
  };
}

// ---------------------------------------------------------------------------
// Matching parsed rows to entries
// ---------------------------------------------------------------------------

export interface MatchableEntry {
  registrationId: string;
  carNumber: string | null;
  competitorLabel: string;
}

export interface MatchedRow {
  row: ParsedResultRow;
  registrationId: string;
  matchedOn: "carNumber" | "competitor";
  competitorLabel: string;
}

export interface MatchResult {
  matched: MatchedRow[];
  unmatched: ParsedResultRow[];
  /** Duplicate targets and ambiguous names — blocking problems. */
  conflicts: ImportIssue[];
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Matches rows to entries by car number first (unique per event), then by
 * competitor name. Ambiguous or duplicated matches are reported rather than
 * guessed — a wrong match would assign a result to the wrong competitor.
 */
export function matchResultRows(
  rows: ParsedResultRow[],
  entries: MatchableEntry[],
): MatchResult {
  const byCarNumber = new Map<string, MatchableEntry>();
  for (const entry of entries) {
    if (entry.carNumber) {
      byCarNumber.set(entry.carNumber.trim().toLowerCase(), entry);
    }
  }

  const byName = new Map<string, MatchableEntry[]>();
  for (const entry of entries) {
    const key = normalizeName(entry.competitorLabel);
    if (!key) continue;
    byName.set(key, [...(byName.get(key) ?? []), entry]);
  }

  const matched: MatchedRow[] = [];
  const unmatched: ParsedResultRow[] = [];
  const conflicts: ImportIssue[] = [];
  const claimed = new Map<string, number>();

  for (const row of rows) {
    let entry: MatchableEntry | undefined;
    let matchedOn: MatchedRow["matchedOn"] = "carNumber";

    if (row.carNumber) {
      entry = byCarNumber.get(row.carNumber.trim().toLowerCase());
    }
    if (!entry && row.competitor) {
      const candidates = byName.get(normalizeName(row.competitor)) ?? [];
      if (candidates.length > 1) {
        conflicts.push({
          rowNumber: row.rowNumber,
          message: `"${row.competitor}" matches ${candidates.length} entries — add a car number column to disambiguate.`,
        });
        continue;
      }
      entry = candidates[0];
      matchedOn = "competitor";
    }

    if (!entry) {
      unmatched.push(row);
      continue;
    }

    const previous = claimed.get(entry.registrationId);
    if (previous !== undefined) {
      conflicts.push({
        rowNumber: row.rowNumber,
        message: `Entry already classified by row ${previous} — remove the duplicate.`,
      });
      continue;
    }
    claimed.set(entry.registrationId, row.rowNumber);

    matched.push({
      row,
      registrationId: entry.registrationId,
      matchedOn,
      competitorLabel: entry.competitorLabel,
    });
  }

  // More than one fastest lap in a single import is a data error.
  const fastestLapRows = matched.filter((m) => m.row.fastestLap);
  if (fastestLapRows.length > 1) {
    conflicts.push({
      rowNumber: fastestLapRows[1].row.rowNumber,
      message: "More than one row is flagged as the fastest lap.",
    });
  }

  return { matched, unmatched, conflicts };
}
