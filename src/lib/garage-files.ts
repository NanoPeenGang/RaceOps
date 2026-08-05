import { GarageFileKind } from "@prisma/client";

/**
 * Telemetry, setups and the rest of what a crew keeps against a car.
 *
 * One model for all three because they share every question worth asking —
 * which car, which circuit, which session, whose lap, how quick — and differ
 * only in what opens them. Splitting them into separate tables would mean
 * writing "the setup and the telemetry from that run" as two queries and two
 * pickers, when it is one thought.
 *
 * Nothing here parses a file. A MoTeC `.ld` and an iRacing `.sto` are opaque
 * binaries; claiming to read a lap time out of one would be a guess printed
 * next to a real number. The lap time is whatever the person uploading types.
 */

export const GARAGE_FILE_LABELS: Record<GarageFileKind, string> = {
  TELEMETRY: "Telemetry",
  SETUP: "Setup",
  DOCUMENT: "Document",
};

export const GARAGE_FILE_DESCRIPTIONS: Record<GarageFileKind, string> = {
  TELEMETRY:
    "Logger exports and data files. What the car actually did, lap by lap.",
  SETUP:
    "Setup sheets and sim setup exports. What the car was doing it with.",
  DOCUMENT: "Manuals, wiring diagrams, corner-weight sheets, build notes.",
};

export const GARAGE_FILE_ORDER: readonly GarageFileKind[] = [
  GarageFileKind.SETUP,
  GarageFileKind.TELEMETRY,
  GarageFileKind.DOCUMENT,
];

/**
 * Extensions offered per kind, as a hint to the file picker.
 *
 * A hint, not a rule — deliberately. Every logger and every sim has its own
 * format, teams convert between them constantly, and a whitelist would reject
 * somebody's real data on a Saturday because we had not heard of their logger.
 * Size is the limit that is actually enforced.
 */
export const GARAGE_FILE_EXTENSIONS: Record<GarageFileKind, readonly string[]> =
  {
    TELEMETRY: [".ld", ".ldx", ".drk", ".xrk", ".csv", ".ibt", ".zip"],
    SETUP: [".sto", ".svm", ".json", ".csv", ".pdf", ".png", ".jpg"],
    DOCUMENT: [".pdf", ".png", ".jpg", ".txt", ".md"],
  };

/**
 * Hard cap per file.
 *
 * A session of high-rate telemetry is genuinely tens of megabytes and a setup
 * is a few kilobytes, but one limit is easier to explain than three and the
 * upload path is the same either way.
 */
export const GARAGE_FILE_MAX_BYTES = 100 * 1024 * 1024;

export interface GarageFileRejection {
  reason: "size" | "empty";
  message: string;
}

export function checkGarageFile(file: {
  size: number;
}): GarageFileRejection | null {
  if (file.size <= 0) {
    return { reason: "empty", message: "That file is empty." };
  }
  if (file.size > GARAGE_FILE_MAX_BYTES) {
    return {
      reason: "size",
      message: `That file is ${formatFileSize(file.size)}; the limit is ${formatFileSize(
        GARAGE_FILE_MAX_BYTES,
      )}.`,
    };
  }
  return null;
}

export function formatFileSize(bytes: number | null | undefined): string {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * "1:43.271" — a lap time as a stopwatch shows it.
 *
 * Sub-minute laps keep the leading seconds rather than dropping to "43.271",
 * because a column of times where some have a colon and some do not cannot be
 * scanned down.
 */
export function formatLapTime(ms: number | null | undefined): string | null {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return null;
  const minutes = Math.floor(ms / 60_000);
  const seconds = (ms % 60_000) / 1000;
  return `${minutes}:${seconds.toFixed(3).padStart(6, "0")}`;
}

/**
 * Parses a typed lap time into milliseconds.
 *
 * Accepts "1:43.271", "103.271" and "1:43" — all three are things people type
 * into a box at a workbench. Returns null rather than throwing or guessing,
 * so a half-typed value simply does not set a time.
 */
export function parseLapTime(input: string): number | null {
  const text = input.trim();
  if (!text) return null;

  const colon = text.indexOf(":");
  if (colon === -1) {
    const seconds = Number(text);
    return Number.isFinite(seconds) && seconds > 0
      ? Math.round(seconds * 1000)
      : null;
  }

  const minutePart = text.slice(0, colon).trim();
  const secondPart = text.slice(colon + 1).trim();
  /*
   * Both halves must actually be there. `Number("")` is 0, so without this a
   * half-typed "1:" reads as a clean 1:00.000 — a plausible lap time, silently
   * committed the moment somebody tabs out of the box mid-entry.
   */
  if (!minutePart || !secondPart) return null;

  const minutes = Number(minutePart);
  const seconds = Number(secondPart);
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) return null;
  if (minutes < 0 || seconds < 0 || seconds >= 60) return null;
  const total = minutes * 60_000 + seconds * 1000;
  return total > 0 ? Math.round(total) : null;
}

export interface GarageFileLike {
  kind: GarageFileKind;
  carId?: string | null;
  trackLayoutId?: string | null;
  bestLapMs?: number | null;
  createdAt: Date | string;
}

/**
 * The setups worth trying here, quickest first.
 *
 * This is the query the whole model exists for: a crew arriving at a circuit
 * wants the setups they have run *at this circuit, on this car*, ordered by
 * what came out of them. Files with no lap time sort last rather than being
 * dropped — an untimed setup from last year is still the one they ran.
 */
export function bestSetupsFor<T extends GarageFileLike>(
  files: readonly T[],
  filter: { carId?: string | null; trackLayoutId?: string | null },
): T[] {
  return files
    .filter((file) => {
      if (file.kind !== GarageFileKind.SETUP) return false;
      if (filter.carId && file.carId !== filter.carId) return false;
      if (filter.trackLayoutId && file.trackLayoutId !== filter.trackLayoutId) {
        return false;
      }
      return true;
    })
    .sort((a, b) => {
      const aLap = a.bestLapMs ?? null;
      const bLap = b.bestLapMs ?? null;
      if (aLap !== null && bLap !== null) return aLap - bLap;
      if (aLap !== null) return -1;
      if (bLap !== null) return 1;
      // Both untimed: newest first, since recency is the only signal left.
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
}

/** Groups a library by kind, in display order, dropping empty kinds. */
export function groupByKind<T extends { kind: GarageFileKind }>(
  files: readonly T[],
): { kind: GarageFileKind; files: T[] }[] {
  return GARAGE_FILE_ORDER.map((kind) => ({
    kind,
    files: files.filter((file) => file.kind === kind),
  })).filter((group) => group.files.length > 0);
}
