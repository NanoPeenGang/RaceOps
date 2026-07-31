import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { TRPCError } from "@trpc/server";
import { serverApi } from "@/server/trpc/server-caller";
import { SESSION_TYPE_LABELS, groupSessionsByDay } from "@/lib/schedule";
import { RESULT_STATUS_LABELS } from "@/lib/standings";
import {
  DOCUMENT_TITLES,
  GENERATED_DOCUMENTS,
  formatSlot,
  type GeneratedDocument,
} from "@/lib/race-documents";
import { PrintButton } from "@/components/print-button";
import { zoneSummary } from "@/lib/credentials";

/**
 * Printable documents, built from data the platform already holds.
 *
 * Server-rendered and deliberately plain: these are sheets that get printed
 * and pinned up, so they carry no interactive chrome beyond a print button
 * that the print stylesheet then hides.
 *
 * Nothing here is stored. A generated document is a view of the entries, so
 * it cannot go stale the way an uploaded PDF does the moment somebody
 * withdraws — which is the whole reason for replacing the upload.
 */

function isGenerated(value: string): value is GeneratedDocument {
  return (GENERATED_DOCUMENTS as readonly string[]).includes(value);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ eventId: string; document: string }>;
}): Promise<Metadata> {
  const { document } = await params;
  if (!isGenerated(document)) return { title: "Not found · RaceOps" };
  return { title: { absolute: `${DOCUMENT_TITLES[document]} · RaceOps` } };
}

export default async function PrintDocumentPage({
  params,
  searchParams,
}: {
  params: Promise<{ eventId: string; document: string }>;
  searchParams: Promise<{ session?: string; perRow?: string }>;
}) {
  const { eventId, document } = await params;
  const { session, perRow } = await searchParams;
  if (!isGenerated(document)) notFound();

  const api = await serverApi();

  try {
    switch (document) {
      case "entry-list": {
        const data = await api.document.entryList({ eventId });
        return (
          <Sheet
            eventId={eventId}
            title="Entry list"
            header={data.header}
            subtitle={`${data.rows.length} confirmed ${data.rows.length === 1 ? "entry" : "entries"}`}
          >
            {data.byClass.map((group) => (
              <section key={group.className ?? "unclassed"} className="space-y-2">
                {data.byClass.length > 1 && (
                  <h2 className="text-sm font-semibold uppercase tracking-wide">
                    {group.className ?? "Class not declared"}
                  </h2>
                )}
                <table className="w-full text-sm">
                  <thead className="border-b border-brand-black/20 text-left text-xs uppercase tracking-wide">
                    <tr>
                      <th className="py-1 pr-3">No.</th>
                      <th className="py-1 pr-3">Entrant</th>
                      <th className="py-1 pr-3">Drivers</th>
                      <th className="py-1 pr-3">Car</th>
                      <th className="py-1 pr-3">Class</th>
                      <th className="py-1 pr-3">Trans.</th>
                      <th className="py-1">Garage</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.rows.map((row) => (
                      <tr
                        key={row.registrationId}
                        className="print-row border-b border-brand-black/5"
                      >
                        <td className="py-1 pr-3 font-semibold tabular-nums">
                          {row.carNumber ?? "—"}
                        </td>
                        <td className="py-1 pr-3">{row.entrant}</td>
                        <td className="py-1 pr-3">
                          {row.drivers.join(", ") || "—"}
                        </td>
                        <td className="py-1 pr-3">{row.car ?? "—"}</td>
                        <td className="py-1 pr-3">
                          {row.classCode ?? row.className ?? "—"}
                        </td>
                        <td className="py-1 pr-3 font-mono text-xs">
                          {row.transponder ?? "—"}
                        </td>
                        <td className="py-1">{row.garage ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            ))}
            {data.rows.length === 0 && (
              <p className="text-sm">No confirmed entries yet.</p>
            )}
          </Sheet>
        );
      }

      case "timetable": {
        const data = await api.document.timetable({ eventId });
        const days = groupSessionsByDay(
          data.rows.map((row) => ({ ...row, id: row.sessionId })),
        );
        return (
          <Sheet
            eventId={eventId}
            title="Timetable"
            header={data.header}
            subtitle={`${data.rows.length} session${data.rows.length === 1 ? "" : "s"}`}
          >
            {days.map((day) => (
              <section key={day.dayKey} className="space-y-2">
                <h2 className="text-sm font-semibold uppercase tracking-wide">
                  {new Date(day.date).toLocaleDateString(undefined, {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                  })}
                </h2>
                <table className="w-full text-sm">
                  <thead className="border-b border-brand-black/20 text-left text-xs uppercase tracking-wide">
                    <tr>
                      <th className="py-1 pr-3">Time</th>
                      <th className="py-1 pr-3">Session</th>
                      <th className="py-1 pr-3">Type</th>
                      <th className="py-1">Where</th>
                    </tr>
                  </thead>
                  <tbody>
                    {day.sessions.map((row) => (
                      <tr
                        key={row.id}
                        className="print-row border-b border-brand-black/5"
                      >
                        <td className="py-1 pr-3 tabular-nums">
                          {formatSlot(row)}
                        </td>
                        <td className="py-1 pr-3 font-medium">{row.name}</td>
                        <td className="py-1 pr-3">
                          {SESSION_TYPE_LABELS[row.type]}
                        </td>
                        <td className="py-1">{row.location ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            ))}
            {data.rows.length === 0 && (
              <p className="text-sm">No sessions scheduled yet.</p>
            )}
          </Sheet>
        );
      }

      case "grid-sheet": {
        const data = await api.document.gridSheet({
          eventId,
          sessionId: session,
          carsPerRow: perRow ? Number(perRow) : 2,
        });
        return (
          <Sheet
            eventId={eventId}
            title="Grid sheet"
            header={data.header}
            subtitle={
              data.session
                ? `Order from ${data.session.name}`
                : "No qualifying session — order by car number"
            }
          >
            <table className="w-full text-sm">
              <thead className="border-b border-brand-black/20 text-left text-xs uppercase tracking-wide">
                <tr>
                  <th className="py-1 pr-3">Pos</th>
                  <th className="py-1 pr-3">Row</th>
                  <th className="py-1 pr-3">No.</th>
                  <th className="py-1 pr-3">Entrant</th>
                  <th className="py-1 pr-3">Class</th>
                  <th className="py-1">Qualifying</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <tr
                    key={row.registrationId}
                    className="print-row border-b border-brand-black/5"
                  >
                    <td className="py-1 pr-3 font-semibold tabular-nums">
                      {row.position}
                    </td>
                    <td className="py-1 pr-3 tabular-nums">
                      {row.gridRow}
                      {row.side === "left" ? "L" : "R"}
                    </td>
                    <td className="py-1 pr-3 font-semibold tabular-nums">
                      {row.carNumber ?? "—"}
                    </td>
                    <td className="py-1 pr-3">{row.entrant}</td>
                    <td className="py-1 pr-3">{row.className ?? "—"}</td>
                    <td className="py-1 tabular-nums">
                      {row.qualifyingTime ?? "no time"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.rows.length === 0 && (
              <p className="text-sm">Nothing to grid yet.</p>
            )}
          </Sheet>
        );
      }

      case "credentials": {
        const data = await api.document.credentialSheet({ eventId });
        return (
          <Sheet
            eventId={eventId}
            title="Passes"
            header={data.header}
            subtitle={`${data.badges.length} pass${data.badges.length === 1 ? "" : "es"}`}
          >
            {data.badges.length === 0 ? (
              <p className="text-sm text-brand-black/60">
                No passes have been issued yet. Generate them from the
                accreditation panel on the manage page.
              </p>
            ) : (
              <>
                {data.withoutCode > 0 && (
                  <p className="mb-4 rounded border border-brand-black/20 p-3 text-sm print:hidden">
                    {data.withoutCode} pass
                    {data.withoutCode === 1 ? " has" : "es have"} no QR code
                    yet. Re-issue them, or refresh the code from the
                    accreditation panel.
                  </p>
                )}
                {/*
                  * Two per row at roughly credit-card proportions, and
                  * `break-inside-avoid` so a badge is never cut in half by a
                  * page break — the one formatting rule that actually matters
                  * on a sheet that gets scissored up.
                  */}
                <div className="grid grid-cols-2 gap-3">
                  {data.badges.map((badge) => (
                    <div
                      key={badge.credentialId}
                      className="flex gap-3 break-inside-avoid rounded-lg border-2 border-brand-black/70 p-3"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-brand-red">
                          {badge.typeName}
                        </p>
                        <p className="truncate text-lg font-bold leading-tight">
                          {badge.holderName}
                        </p>
                        <p className="text-xs text-brand-black/70">
                          {badge.holderRole ?? "\u00A0"}
                        </p>
                        {(badge.teamName || badge.carNumber) && (
                          <p className="mt-0.5 truncate text-xs text-brand-black/70">
                            {[
                              badge.carNumber ? `#${badge.carNumber}` : null,
                              badge.teamName,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                        )}
                        <p className="mt-2 text-[10px] font-semibold uppercase leading-snug tracking-wide">
                          {zoneSummary(badge.zones) ?? "Access not specified"}
                        </p>
                        <p className="mt-1 text-[9px] text-brand-black/50">
                          {[badge.serial, data.header.eventName]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </div>
                      {badge.qr && (
                        <div
                          className="h-[92px] w-[92px] shrink-0 [&>svg]:h-full [&>svg]:w-full"
                          // Server-rendered by the qrcode library from a URL
                          // we construct; no user content reaches this markup.
                          dangerouslySetInnerHTML={{ __html: badge.qr }}
                        />
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </Sheet>
        );
      }

      case "timing-sheet": {
        const data = await api.document.timingSheet({
          eventId,
          sessionId: session,
        });
        // Before a session this is ruled paper; after it, the classification.
        const filled = data.rows.some((row) => row.position !== null);
        return (
          <Sheet
            eventId={eventId}
            title="Timing sheet"
            header={data.header}
            subtitle={data.session?.name ?? "All confirmed entries"}
          >
            <table className="w-full text-sm">
              <thead className="border-b border-brand-black/20 text-left text-xs uppercase tracking-wide">
                <tr>
                  <th className="py-1 pr-3">Pos</th>
                  <th className="py-1 pr-3">No.</th>
                  <th className="py-1 pr-3">Entrant</th>
                  <th className="py-1 pr-3">Class</th>
                  <th className="py-1 pr-3">Trans.</th>
                  <th className="py-1 pr-3">Laps</th>
                  <th className="py-1 pr-3">Best</th>
                  <th className="py-1">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <tr
                    key={row.registrationId}
                    className="print-row border-b border-brand-black/10"
                  >
                    <td className="py-2 pr-3 tabular-nums">
                      {row.position ?? ""}
                    </td>
                    <td className="py-2 pr-3 font-semibold tabular-nums">
                      {row.carNumber ?? "—"}
                    </td>
                    <td className="py-2 pr-3">{row.entrant}</td>
                    <td className="py-2 pr-3">{row.className ?? "—"}</td>
                    <td className="py-2 pr-3 font-mono text-xs">
                      {row.transponder ?? "—"}
                    </td>
                    <td className="py-2 pr-3 tabular-nums">{row.laps ?? ""}</td>
                    <td className="py-2 pr-3 tabular-nums">
                      {row.bestLap ?? ""}
                    </td>
                    <td className="py-2">
                      {row.status ? RESULT_STATUS_LABELS[row.status] : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!filled && (
              <p className="text-xs text-brand-black/60 print:hidden">
                Nothing timed yet — print this as the hand-timing sheet.
              </p>
            )}
          </Sheet>
        );
      }
    }
  } catch (error) {
    if (error instanceof TRPCError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
}

function Sheet({
  eventId,
  title,
  subtitle,
  header,
  children,
}: {
  eventId: string;
  title: string;
  subtitle?: string;
  header: {
    eventName: string;
    seriesName: string | null;
    venue: string | null;
    date: Date;
    generatedAt: Date;
  };
  children: React.ReactNode;
}) {
  return (
    <article className="print-document mx-auto max-w-4xl space-y-5">
      <div className="print:hidden">
        <Link
          href={`/events/${eventId}`}
          className="text-sm text-brand-red hover:underline"
        >
          ← {header.eventName}
        </Link>
      </div>

      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-brand-black/20 pb-3">
        <div>
          <h1 className="text-2xl font-bold">{title}</h1>
          <p className="text-sm text-brand-black/70">
            {[header.seriesName, header.eventName, header.venue]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <p className="text-xs text-brand-black/60">
            {new Date(header.date).toLocaleDateString()}
            {subtitle ? ` · ${subtitle}` : ""}
          </p>
        </div>
        {/* Two copies of a sheet are told apart by when they were run off —
            which is why paddocks put a time on every revision. */}
        <p className="text-xs text-brand-black/60">
          Generated {new Date(header.generatedAt).toLocaleString()}
        </p>
      </header>

      {children}

      <PrintButton />
    </article>
  );
}
