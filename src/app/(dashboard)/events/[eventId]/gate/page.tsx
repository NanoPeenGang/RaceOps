import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { TRPCError } from "@trpc/server";
import { serverApi } from "@/server/trpc/server-caller";
import { GateConsole } from "./gate-console";

/**
 * Gate control for one event.
 *
 * Deliberately its own page rather than a tab on the manage console: it is
 * used standing up, on a phone, by somebody whose entire job for the next four
 * hours is this one screen. Nothing else belongs on it.
 *
 * Authorization is checked here on the server as well as on every scan, so a
 * marshal who has lost their role does not keep a working gate open in a tab.
 */

export const metadata: Metadata = {
  title: "Gate · RaceOps",
  robots: { index: false, follow: false },
};

export default async function GatePage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  const api = await serverApi();

  let event;
  try {
    // Any organizer-only query serves as the gate on this page; the scan
    // counts are the one it is going to load anyway.
    const [loaded] = await Promise.all([
      api.event.byId({ eventId }),
      api.paddock.scanCounts({ eventId }),
    ]);
    event = loaded;
  } catch (error) {
    if (error instanceof TRPCError) {
      if (error.code === "NOT_FOUND" || error.code === "BAD_REQUEST") {
        notFound();
      }
      if (error.code === "FORBIDDEN" || error.code === "UNAUTHORIZED") {
        return (
          <div className="mx-auto max-w-md space-y-3 p-4 text-center">
            <h1 className="text-xl font-semibold">Gate control</h1>
            <p className="text-sm text-brand-black/60">
              Only this event&rsquo;s organizers can work a gate. Ask them to add
              you, then reload.
            </p>
            <Link
              href={`/events/${eventId}`}
              className="inline-block text-sm text-brand-red hover:underline"
            >
              ← {`Back to the event`}
            </Link>
          </div>
        );
      }
    }
    throw error;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <header className="space-y-1">
        <Link
          href={`/events/${eventId}/manage`}
          className="text-sm text-brand-red hover:underline"
        >
          ← {event.name}
        </Link>
        <h1 className="text-2xl font-bold">Gate control</h1>
        <p className="text-sm text-brand-black/60">
          Scan a pass to check it against this gate. Every scan is recorded,
          including the refusals.
        </p>
      </header>

      <GateConsole eventId={eventId} />
    </div>
  );
}
