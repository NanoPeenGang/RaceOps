import { RegistrationStatus, ResultStatus, SessionType } from "@prisma/client";
import { formatLapTime } from "@/lib/lap-time";

/**
 * Documents built from data the platform already holds.
 *
 * The entry list and the timetable are currently PDFs somebody types up and
 * uploads under `ENTRY_LIST` / `SCHEDULE`, while the confirmed entries and the
 * session schedule sit right here. The shapes below are what a printable page
 * renders — no formatting decisions, just the rows in the right order with the
 * right things on them.
 */

export const GENERATED_DOCUMENTS = [
  "entry-list",
  "timetable",
  "grid-sheet",
  "timing-sheet",
  "credentials",
] as const;

export type GeneratedDocument = (typeof GENERATED_DOCUMENTS)[number];

/**
 * Documents only an organizer may see.
 *
 * The rest are views of what the event already publishes — the entry list is
 * on the public page anyway. Passes are not: a sheet of scannable badges is a
 * sheet of working credentials, so it is listed and served to organizers only.
 */
export const ORGANIZER_ONLY_DOCUMENTS: readonly GeneratedDocument[] = [
  "credentials",
];

export function isOrganizerOnly(document: GeneratedDocument): boolean {
  return ORGANIZER_ONLY_DOCUMENTS.includes(document);
}

export const DOCUMENT_TITLES: Record<GeneratedDocument, string> = {
  "entry-list": "Entry list",
  timetable: "Timetable",
  "grid-sheet": "Grid sheet",
  "timing-sheet": "Timing sheet",
  credentials: "Passes",
};

export const DOCUMENT_DESCRIPTIONS: Record<GeneratedDocument, string> = {
  "entry-list": "Confirmed entries with crew, car and class.",
  timetable: "The running order, grouped by day.",
  "grid-sheet": "Starting order, ready to hand to the grid marshals.",
  "timing-sheet": "Blank sheet for hand timing, or the session's results.",
  credentials:
    "Badges with a QR code, cut out and put in a lanyard. Organizers only.",
};

// ---------------------------------------------------------------------------
// Entry list
// ---------------------------------------------------------------------------

export interface EntryListRow {
  registrationId: string;
  /// Sorts numerically where the number is a number, and by text otherwise:
  /// "7" comes before "11", but "7A" still sorts sensibly beside "7".
  carNumber: string | null;
  entrant: string;
  className: string | null;
  classCode: string | null;
  drivers: string[];
  car: string | null;
  transponder: string | null;
  garage: string | null;
}

export interface EntryListSource {
  id: string;
  carNumber: string | null;
  carClass: string | null;
  status: RegistrationStatus;
  team: { name: string } | null;
  entrantUser: { profile: { displayName: string } | null } | null;
  seriesClass: { name: string; code: string | null } | null;
  lineup: { user: { profile: { displayName: string } | null } }[];
  car: { name: string; make: string | null; model: string | null } | null;
  transponders: { isPrimary: boolean; transponder: { number: string } }[];
  paddock: { garage: string | null } | null;
}

/**
 * Sort key for a car number.
 *
 * Race numbers are strings — "7", "07", "7A", "MINI" are all real — but a
 * sheet sorted lexically puts 11 before 7 and every organizer notices. Numbers
 * lead, sorted numerically, and anything else follows alphabetically.
 */
export function carNumberSortKey(
  carNumber: string | null,
): [number, number, string] {
  if (!carNumber) return [2, 0, ""];
  const numeric = /^(\d+)(.*)$/.exec(carNumber.trim());
  if (numeric) return [0, Number(numeric[1]), numeric[2].toLowerCase()];
  return [1, 0, carNumber.trim().toLowerCase()];
}

export function compareCarNumbers(
  a: string | null,
  b: string | null,
): number {
  const [aGroup, aNumber, aRest] = carNumberSortKey(a);
  const [bGroup, bNumber, bRest] = carNumberSortKey(b);
  return aGroup - bGroup || aNumber - bNumber || aRest.localeCompare(bRest);
}

export function buildEntryList(
  registrations: EntryListSource[],
): EntryListRow[] {
  return registrations
    .filter(
      (registration) => registration.status === RegistrationStatus.CONFIRMED,
    )
    .map((registration) => {
      const primary =
        registration.transponders.find(
          (assignment) => assignment.isPrimary,
        ) ?? registration.transponders[0];
      return {
        registrationId: registration.id,
        carNumber: registration.carNumber,
        entrant:
          registration.team?.name ??
          registration.entrantUser?.profile?.displayName ??
          "Entry",
        // The declared class wins over the free-text one; the free text stays
        // for series that declare no classes at all.
        className: registration.seriesClass?.name ?? registration.carClass,
        classCode: registration.seriesClass?.code ?? null,
        drivers: registration.lineup
          .map((driver) => driver.user.profile?.displayName)
          .filter((name): name is string => Boolean(name)),
        car: registration.car
          ? [registration.car.make, registration.car.model]
              .filter(Boolean)
              .join(" ") || registration.car.name
          : null,
        transponder: primary?.transponder.number ?? null,
        garage: registration.paddock?.garage ?? null,
      };
    })
    .sort((a, b) => compareCarNumbers(a.carNumber, b.carNumber));
}

/**
 * Entry list split by class, for a multi-class grid.
 * Entries with no class fall into a single unnamed group rather than being
 * dropped — a series that declares classes will still have entries awaiting
 * one on the Thursday.
 */
export function entryListByClass(
  rows: EntryListRow[],
): { className: string | null; rows: EntryListRow[] }[] {
  const groups = new Map<string, EntryListRow[]>();
  for (const row of rows) {
    const key = row.className ?? "";
    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  }
  return [...groups.entries()]
    .sort((a, b) => {
      if (a[0] === "") return 1;
      if (b[0] === "") return -1;
      return a[0].localeCompare(b[0]);
    })
    .map(([className, grouped]) => ({
      className: className || null,
      rows: grouped,
    }));
}

// ---------------------------------------------------------------------------
// Timetable
// ---------------------------------------------------------------------------

export interface TimetableRow {
  sessionId: string;
  type: SessionType;
  name: string;
  startsAt: Date;
  endsAt: Date;
  location: string | null;
  /// Minutes, which is how a running order is read and checked.
  durationMinutes: number;
}

export function buildTimetable(
  sessions: {
    id: string;
    type: SessionType;
    name: string;
    startsAt: Date;
    endsAt: Date;
    location: string | null;
  }[],
): TimetableRow[] {
  return [...sessions]
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
    .map((session) => ({
      sessionId: session.id,
      type: session.type,
      name: session.name,
      startsAt: session.startsAt,
      endsAt: session.endsAt,
      location: session.location,
      durationMinutes: Math.max(
        0,
        Math.round(
          (session.endsAt.getTime() - session.startsAt.getTime()) / 60000,
        ),
      ),
    }));
}

/** "09:00–09:45 (45 min)" — the form a running order is checked in. */
export function formatSlot(row: TimetableRow): string {
  const time = (at: Date) =>
    at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return `${time(row.startsAt)}–${time(row.endsAt)} (${row.durationMinutes} min)`;
}

// ---------------------------------------------------------------------------
// Grid sheet
// ---------------------------------------------------------------------------

export interface GridRow {
  position: number;
  /// Row on the grid, 1-indexed. Two cars per row is near-universal.
  gridRow: number;
  side: "left" | "right";
  registrationId: string;
  carNumber: string | null;
  entrant: string;
  className: string | null;
  qualifyingTime: string | null;
}

export interface GridSource {
  registrationId: string;
  carNumber: string | null;
  entrant: string;
  className: string | null;
  bestLapMs: number | null;
  /// Set when qualifying was not run and the order comes from elsewhere.
  position: number | null;
}

/**
 * Starting order from a qualifying session.
 *
 * Cars with no time go to the back in entry order rather than being dropped:
 * a car that failed to set a time still starts, and the grid marshals need it
 * on the sheet. `carsPerRow` is configurable because karting and some club
 * grids form up three or four abreast.
 */
export function buildGrid(
  entries: GridSource[],
  carsPerRow = 2,
): GridRow[] {
  const timed = entries.filter((entry) => entry.bestLapMs !== null);
  const untimed = entries.filter((entry) => entry.bestLapMs === null);

  timed.sort((a, b) => {
    // An explicit position (a stewards' grid drop, a hand-set order) wins.
    if (a.position !== null && b.position !== null) {
      return a.position - b.position;
    }
    if (a.position !== null) return -1;
    if (b.position !== null) return 1;
    return (a.bestLapMs ?? 0) - (b.bestLapMs ?? 0);
  });
  untimed.sort((a, b) => compareCarNumbers(a.carNumber, b.carNumber));

  return [...timed, ...untimed].map((entry, index) => ({
    position: index + 1,
    gridRow: Math.floor(index / carsPerRow) + 1,
    side: index % carsPerRow === 0 ? "left" : "right",
    registrationId: entry.registrationId,
    carNumber: entry.carNumber,
    entrant: entry.entrant,
    className: entry.className,
    qualifyingTime:
      entry.bestLapMs === null ? null : formatLapTime(entry.bestLapMs),
  }));
}

// ---------------------------------------------------------------------------
// Timing sheet
// ---------------------------------------------------------------------------

export interface TimingSheetRow {
  registrationId: string;
  carNumber: string | null;
  entrant: string;
  className: string | null;
  transponder: string | null;
  /// Present when the sheet is printed after the session rather than before.
  position: number | null;
  laps: number | null;
  bestLap: string | null;
  status: ResultStatus | null;
}

/**
 * A timing sheet, blank or filled.
 *
 * Printed before a session it is ruled paper with the grid already on it,
 * which is what a hand-timing crew actually wants; printed afterwards it is
 * the classification. Same rows either way.
 */
export function buildTimingSheet(
  entries: {
    registrationId: string;
    carNumber: string | null;
    entrant: string;
    className: string | null;
    transponder: string | null;
    position?: number | null;
    lapsCompleted?: number | null;
    bestLapMs?: number | null;
    status?: ResultStatus | null;
  }[],
): TimingSheetRow[] {
  return [...entries]
    .sort((a, b) => {
      // Once positions exist the sheet is a classification and reads in
      // finishing order; before that it reads by car number.
      if (a.position != null && b.position != null) {
        return a.position - b.position;
      }
      if (a.position != null) return -1;
      if (b.position != null) return 1;
      return compareCarNumbers(a.carNumber, b.carNumber);
    })
    .map((entry) => ({
      registrationId: entry.registrationId,
      carNumber: entry.carNumber,
      entrant: entry.entrant,
      className: entry.className,
      transponder: entry.transponder,
      position: entry.position ?? null,
      laps: entry.lapsCompleted ?? null,
      bestLap:
        entry.bestLapMs === null || entry.bestLapMs === undefined
          ? null
          : formatLapTime(entry.bestLapMs),
      status: entry.status ?? null,
    }));
}
