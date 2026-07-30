import { RegistrationStatus, SessionType } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import {
  buildEntryList,
  buildGrid,
  buildTimetable,
  buildTimingSheet,
  entryListByClass,
  type EntryListRow,
  type GridRow,
  type TimetableRow,
  type TimingSheetRow,
} from "@/lib/race-documents";
import { eventVenueLabel } from "@/lib/tracks";

/**
 * Assembling the generated documents.
 *
 * Everything here comes from records the platform already holds — confirmed
 * entries, the session schedule, the timing board. Nothing is stored: a
 * generated document is a view, so it cannot drift from the entries it
 * describes the way an uploaded PDF does the moment someone withdraws.
 */

export interface DocumentHeader {
  eventId: string;
  eventName: string;
  seriesName: string | null;
  venue: string | null;
  date: Date;
  endDate: Date | null;
  /// When the page was built, printed on the sheet so two copies can be told
  /// apart — the reason paddocks put a time on every revision.
  generatedAt: Date;
}

async function headerFor(
  db: PrismaClient,
  eventId: string,
): Promise<DocumentHeader | null> {
  const event = await db.raceEvent.findUnique({
    where: { id: eventId },
    select: {
      id: true,
      name: true,
      date: true,
      endDate: true,
      venue: true,
      series: { select: { name: true } },
      trackLayout: {
        select: { name: true, track: { select: { name: true } } },
      },
    },
  });
  if (!event) return null;
  return {
    eventId: event.id,
    eventName: event.name,
    seriesName: event.series?.name ?? null,
    venue: eventVenueLabel(event),
    date: event.date,
    endDate: event.endDate,
    generatedAt: new Date(),
  };
}

export interface EntryListDocument {
  header: DocumentHeader;
  rows: EntryListRow[];
  byClass: { className: string | null; rows: EntryListRow[] }[];
}

export async function entryListDocument(
  db: PrismaClient,
  eventId: string,
): Promise<EntryListDocument | null> {
  const header = await headerFor(db, eventId);
  if (!header) return null;

  const registrations = await db.eventRegistration.findMany({
    where: { eventId, status: RegistrationStatus.CONFIRMED },
    select: {
      id: true,
      carNumber: true,
      carClass: true,
      status: true,
      team: { select: { name: true } },
      entrantUser: { select: { profile: { select: { displayName: true } } } },
      seriesClass: { select: { name: true, code: true } },
      lineup: {
        orderBy: { role: "asc" },
        select: { user: { select: { profile: { select: { displayName: true } } } } },
      },
      car: { select: { name: true, make: true, model: true } },
      transponders: {
        select: { isPrimary: true, transponder: { select: { number: true } } },
      },
      paddock: { select: { garage: true } },
    },
  });

  const rows = buildEntryList(registrations);
  return { header, rows, byClass: entryListByClass(rows) };
}

export interface TimetableDocument {
  header: DocumentHeader;
  rows: TimetableRow[];
}

export async function timetableDocument(
  db: PrismaClient,
  eventId: string,
): Promise<TimetableDocument | null> {
  const header = await headerFor(db, eventId);
  if (!header) return null;

  const sessions = await db.eventSession.findMany({
    where: { eventId },
    select: {
      id: true,
      type: true,
      name: true,
      startsAt: true,
      endsAt: true,
      location: true,
    },
  });
  return { header, rows: buildTimetable(sessions) };
}

export interface GridDocument {
  header: DocumentHeader;
  session: { id: string; name: string } | null;
  rows: GridRow[];
}

/**
 * The starting order for a race.
 *
 * Built from a qualifying session's timing board. When no session is named the
 * latest finished qualifying session is used, because that is the one a grid
 * sheet is almost always wanted for.
 */
export async function gridDocument(
  db: PrismaClient,
  eventId: string,
  options: { sessionId?: string; carsPerRow?: number } = {},
): Promise<GridDocument | null> {
  const header = await headerFor(db, eventId);
  if (!header) return null;

  const session = options.sessionId
    ? await db.eventSession.findFirst({
        where: { id: options.sessionId, eventId },
        select: { id: true, name: true },
      })
    : await db.eventSession.findFirst({
        where: { eventId, type: SessionType.QUALIFYING },
        orderBy: { startsAt: "desc" },
        select: { id: true, name: true },
      });

  if (!session) {
    // No qualifying to build from. The entry list is still a usable grid for
    // a club meeting that grids by entry order, so it is returned rather than
    // an empty sheet.
    const entries = await entryListDocument(db, eventId);
    return {
      header,
      session: null,
      rows: buildGrid(
        (entries?.rows ?? []).map((row) => ({
          registrationId: row.registrationId,
          carNumber: row.carNumber,
          entrant: row.entrant,
          className: row.className,
          bestLapMs: null,
          position: null,
        })),
        options.carsPerRow,
      ),
    };
  }

  const timing = await db.timingEntry.findMany({
    where: { sessionId: session.id },
    select: {
      registrationId: true,
      bestLapMs: true,
      position: true,
      registration: {
        select: {
          carNumber: true,
          carClass: true,
          team: { select: { name: true } },
          entrantUser: {
            select: { profile: { select: { displayName: true } } },
          },
          seriesClass: { select: { name: true } },
        },
      },
    },
  });

  const rows = buildGrid(
    timing.map((entry) => ({
      registrationId: entry.registrationId,
      carNumber: entry.registration.carNumber,
      entrant:
        entry.registration.team?.name ??
        entry.registration.entrantUser?.profile?.displayName ??
        "Entry",
      className:
        entry.registration.seriesClass?.name ??
        entry.registration.carClass ??
        null,
      bestLapMs: entry.bestLapMs,
      position: entry.position,
    })),
    options.carsPerRow,
  );

  return { header, session, rows };
}

export interface TimingSheetDocument {
  header: DocumentHeader;
  session: { id: string; name: string } | null;
  rows: TimingSheetRow[];
}

/**
 * A timing sheet: ruled paper before the session, the classification after.
 * Both come from the same rows, which is the point — a hand-timing crew fills
 * in the sheet they were given rather than transcribing between two.
 */
export async function timingSheetDocument(
  db: PrismaClient,
  eventId: string,
  sessionId?: string,
): Promise<TimingSheetDocument | null> {
  const header = await headerFor(db, eventId);
  if (!header) return null;

  const session = sessionId
    ? await db.eventSession.findFirst({
        where: { id: sessionId, eventId },
        select: { id: true, name: true },
      })
    : null;

  const registrations = await db.eventRegistration.findMany({
    where: { eventId, status: RegistrationStatus.CONFIRMED },
    select: {
      id: true,
      carNumber: true,
      carClass: true,
      team: { select: { name: true } },
      entrantUser: { select: { profile: { select: { displayName: true } } } },
      seriesClass: { select: { name: true } },
      transponders: {
        select: { isPrimary: true, transponder: { select: { number: true } } },
      },
      ...(session
        ? {
            timingEntries: {
              where: { sessionId: session.id },
              select: {
                position: true,
                lapsCompleted: true,
                bestLapMs: true,
              },
            },
          }
        : {}),
      result: { select: { status: true } },
    },
  });

  const rows = buildTimingSheet(
    registrations.map((registration) => {
      const timing =
        "timingEntries" in registration
          ? (
              registration.timingEntries as {
                position: number | null;
                lapsCompleted: number;
                bestLapMs: number | null;
              }[]
            )[0]
          : undefined;
      const primary =
        registration.transponders.find((a) => a.isPrimary) ??
        registration.transponders[0];
      return {
        registrationId: registration.id,
        carNumber: registration.carNumber,
        entrant:
          registration.team?.name ??
          registration.entrantUser?.profile?.displayName ??
          "Entry",
        className:
          registration.seriesClass?.name ?? registration.carClass ?? null,
        transponder: primary?.transponder.number ?? null,
        position: timing?.position ?? null,
        lapsCompleted: timing?.lapsCompleted ?? null,
        bestLapMs: timing?.bestLapMs ?? null,
        status: registration.result?.status ?? null,
      };
    }),
  );

  return { header, session, rows };
}
