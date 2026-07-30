import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { TRPCError } from "@trpc/server";
import { serverApi } from "@/server/trpc/server-caller";
import { logTime } from "@/lib/officials-log";
import { eventVenueLabel } from "@/lib/tracks";
import { Card, CardContent } from "@/components/ui/card";

/**
 * The end-of-meeting bulletin: race control's published log, in order.
 *
 * Server-rendered because it is a document — something people link to, print
 * and file, not a live view. The print stylesheet strips the app chrome so the
 * page comes off a paddock printer looking like the bulletin it is.
 */

async function loadBulletin(eventId: string) {
  try {
    return await (await serverApi()).log.bulletin({ eventId });
  } catch (error) {
    if (
      error instanceof TRPCError &&
      (error.code === "NOT_FOUND" || error.code === "BAD_REQUEST")
    ) {
      return null;
    }
    throw error;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ eventId: string }>;
}): Promise<Metadata> {
  const { eventId } = await params;
  const bulletin = await loadBulletin(eventId);
  if (!bulletin) return { title: "Bulletin not found · RaceOps" };
  return {
    title: { absolute: `Bulletin — ${bulletin.event.name} · RaceOps` },
    description: `Race control's published log for ${bulletin.event.name}.`,
  };
}

export default async function BulletinPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  const bulletin = await loadBulletin(eventId);
  if (!bulletin) notFound();

  const { event, sections } = bulletin;
  const venue = eventVenueLabel(event);

  return (
    <article className="print-document mx-auto max-w-3xl space-y-6">
      <header className="space-y-1 border-b border-brand-black/10 pb-4">
        <Link
          href={`/events/${eventId}`}
          className="text-sm text-brand-red hover:underline print:hidden"
        >
          ← {event.name}
        </Link>
        <h1 className="text-3xl font-bold">Official bulletin</h1>
        <p className="text-sm text-brand-black/60">
          {[
            event.series?.name,
            event.name,
            venue,
            new Date(event.date).toLocaleDateString(),
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </header>

      {sections.length === 0 ? (
        <p className="text-brand-black/60">
          Nothing has been published yet. Race control publishes the bulletin at
          the end of the meeting.
        </p>
      ) : (
        sections.map((section) => (
          <section key={section.category} className="space-y-2">
            <h2 className="text-lg font-semibold">{section.label}</h2>
            <Card>
              <CardContent className="divide-y divide-brand-black/5 p-0">
                {section.entries.map((entry) => (
                  <div key={entry.id} className="px-4 py-2 text-sm">
                    <span className="font-mono text-xs tabular-nums text-brand-black/60">
                      {logTime(new Date(entry.occurredAt))}
                    </span>{" "}
                    {entry.summary}
                    {entry.session && (
                      <span className="text-brand-black/60">
                        {" "}
                        · {entry.session.name}
                      </span>
                    )}
                    {entry.detail && (
                      <p className="mt-0.5 text-xs text-brand-black/60">
                        {entry.detail}
                      </p>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          </section>
        ))
      )}

      <footer className="border-t border-brand-black/10 pt-4 text-xs text-brand-black/50">
        Issued by race control. Times are as logged at the circuit.
      </footer>
    </article>
  );
}
