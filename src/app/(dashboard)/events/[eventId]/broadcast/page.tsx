import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { TRPCError } from "@trpc/server";
import { serverApi } from "@/server/trpc/server-caller";
import { SESSION_TYPE_LABELS } from "@/lib/schedule";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { PrintButton } from "@/components/print-button";
import { OverlayLinks } from "./overlay-links";
import { PageHeader, Section } from "@/components/ui/page";

/**
 * Everything a broadcast needs: the commentator pack and the overlay feeds.
 *
 * Both fall out of live timing and the championship tables that already
 * exist, and both are the most visible thing a sim league produces — the
 * stream is what most people ever see of it.
 */

async function loadPack(eventId: string) {
  try {
    return await (await serverApi()).document.commentatorPack({ eventId });
  } catch (error) {
    if (error instanceof TRPCError && error.code === "NOT_FOUND") return null;
    throw error;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ eventId: string }>;
}): Promise<Metadata> {
  const { eventId } = await params;
  const pack = await loadPack(eventId);
  if (!pack) return { title: "Not found · RaceOps" };
  return {
    title: { absolute: `Broadcast pack — ${pack.event.name} · RaceOps` },
    description: `Commentator notes and overlay feeds for ${pack.event.name}.`,
  };
}

export default async function BroadcastPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  const pack = await loadPack(eventId);
  if (!pack) notFound();

  const api = await serverApi();
  const sessions = await api.session.forEvent({ eventId });

  return (
    <div className="print-document space-y-8">
      <header className="space-y-1 border-b border-brand-black/10 pb-4">
        <Link
          href={`/events/${eventId}`}
          className="text-sm text-brand-red hover:underline print:hidden"
        >
          ← {pack.event.name}
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <PageHeader title="Broadcast pack" />
            <p className="text-sm text-brand-black/60">
              {[
                pack.series?.name,
                pack.event.name,
                pack.event.venue,
                new Date(pack.event.date).toLocaleDateString(),
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          <PrintButton label="Print the pack" />
        </div>
      </header>

      {pack.talkingPoints.length > 0 && (
        <Section title="Talking points">
          <Card>
            <CardContent className="space-y-1 p-4 text-sm">
              {pack.talkingPoints.map((point) => (
                <p key={point}>{point}</p>
              ))}
            </CardContent>
          </Card>
        </Section>
      )}

      <section className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-xl font-semibold">Entries</h2>
          {pack.series && (
            <p className="text-sm text-brand-black/60">
              {pack.series.roundsRemaining} round
              {pack.series.roundsRemaining === 1 ? "" : "s"} left after this one
            </p>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-brand-black/20 text-left text-xs uppercase tracking-wide">
              <tr>
                <th className="py-1 pr-3">No.</th>
                <th className="py-1 pr-3">Entrant</th>
                <th className="py-1 pr-3">Drivers</th>
                <th className="py-1 pr-3">Car</th>
                <th className="py-1 pr-3">Class</th>
                <th className="py-1 pr-3">Champ.</th>
                <th className="py-1 pr-3">Pts</th>
                <th className="py-1">Season</th>
              </tr>
            </thead>
            <tbody>
              {pack.entries.map((entry) => (
                <tr
                  key={`${entry.carNumber}-${entry.entrant}`}
                  className="print-row border-b border-brand-black/5"
                >
                  <td className="py-1 pr-3 font-semibold tabular-nums">
                    {entry.carNumber ?? "—"}
                  </td>
                  <td className="py-1 pr-3">{entry.entrant}</td>
                  <td className="py-1 pr-3">
                    {entry.drivers.join(", ") || "—"}
                  </td>
                  <td className="py-1 pr-3">{entry.car ?? "—"}</td>
                  <td className="py-1 pr-3">{entry.className ?? "—"}</td>
                  <td className="py-1 pr-3 tabular-nums">
                    {entry.championshipPosition ?? "—"}
                    {entry.titleStillPossible === false && (
                      <span className="ml-1 text-xs text-brand-black/50">
                        (out)
                      </span>
                    )}
                  </td>
                  <td className="py-1 pr-3 tabular-nums">
                    {entry.championshipPoints ?? "—"}
                    {entry.pointsBehindLeader ? (
                      <span className="text-xs text-brand-black/50">
                        {" "}
                        −{entry.pointsBehindLeader}
                      </span>
                    ) : null}
                  </td>
                  <td className="py-1 text-xs text-brand-black/70">
                    {[
                      `${entry.starts} start${entry.starts === 1 ? "" : "s"}`,
                      entry.wins > 0
                        ? `${entry.wins} win${entry.wins === 1 ? "" : "s"}`
                        : null,
                      entry.podiums > 0
                        ? `${entry.podiums} podium${entry.podiums === 1 ? "" : "s"}`
                        : null,
                      entry.penaltyCount > 0
                        ? `${entry.penaltyCount} penalt${entry.penaltyCount === 1 ? "y" : "ies"}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {pack.entries.length === 0 && (
          <p className="text-sm text-brand-black/60">
            No confirmed entries yet.
          </p>
        )}
      </section>

      <section className="space-y-2 print:hidden">
        <div>
          <h2 className="text-xl font-semibold">Overlay feeds</h2>
          <p className="text-sm text-brand-black/60">
            Point an OBS browser source at one of these. Every value is
            pre-formatted, so the overlay renders strings rather than doing time
            arithmetic.
          </p>
        </div>
        {sessions.length === 0 ? (
          <p className="text-sm text-brand-black/60">
            No sessions scheduled — an overlay feed hangs off a session.
          </p>
        ) : (
          <div className="space-y-2">
            {sessions.map((session) => (
              <Card key={session.id}>
                <CardContent className="flex flex-wrap items-center justify-between gap-2 p-4">
                  <div>
                    <p className="font-medium">{session.name}</p>
                    <p className="text-xs text-brand-black/60">
                      {SESSION_TYPE_LABELS[session.type]}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {session.status === "LIVE" && (
                      <Badge variant="verified">Live</Badge>
                    )}
                    <OverlayLinks sessionId={session.id} />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
