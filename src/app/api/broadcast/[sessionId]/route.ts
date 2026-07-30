import { NextResponse } from "next/server";
import { EventStatus, SessionStatus } from "@prisma/client";
import { db } from "@/server/db/client";
import { sortTimingRows } from "@/lib/timing";
import { buildOverlayRows, type OverlayFeed } from "@/lib/broadcast";
import { currentConditions, describeConditions } from "@/lib/conditions";

/**
 * Stream-overlay feed for a session.
 *
 * A flat JSON document an OBS browser source can poll — which is why every
 * value is pre-formatted rather than raw milliseconds: an overlay is usually
 * someone's hand-written HTML, and every formatting decision left to it is
 * one it will get wrong.
 *
 * Public and unauthenticated, deliberately. An overlay runs in a browser
 * source with no way to hold a secret, and the timing board it mirrors is
 * already public. Draft events are the exception: they are not public
 * anywhere else and must not become public here.
 */

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;

  const session = await db.eventSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      name: true,
      type: true,
      status: true,
      flagState: true,
      event: { select: { id: true, name: true, status: true } },
      conditions: {
        orderBy: { recordedAt: "desc" },
        take: 1,
        select: {
          recordedAt: true,
          trackState: true,
          weather: true,
          airTempC: true,
          trackTempC: true,
        },
      },
    },
  });

  if (!session || session.event.status === EventStatus.DRAFT) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const entries = await db.timingEntry.findMany({
    where: { sessionId },
    select: {
      registrationId: true,
      position: true,
      lapsCompleted: true,
      gapMs: true,
      lastLapMs: true,
      bestLapMs: true,
      status: true,
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

  const ordered = sortTimingRows(
    entries.map((entry) => ({
      ...entry,
      id: entry.registrationId,
    })),
  );

  const rows = buildOverlayRows(
    ordered.map((entry) => ({
      position: entry.position,
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
      lapsCompleted: entry.lapsCompleted,
      gapMs: entry.gapMs,
      lastLapMs: entry.lastLapMs,
      bestLapMs: entry.bestLapMs,
      status: entry.status,
    })),
  );

  const fastest = rows.find((row) => row.fastest) ?? null;

  const feed: OverlayFeed = {
    event: { id: session.event.id, name: session.event.name },
    session: {
      id: session.id,
      name: session.name,
      type: session.type,
      status: session.status,
      flag: session.flagState,
    },
    conditions: describeConditions(currentConditions(session.conditions)),
    rows,
    fastestLap: fastest
      ? {
          carNumber: fastest.carNumber,
          shortName: fastest.shortName,
          time: fastest.bestLap,
        }
      : null,
    updatedAt: new Date().toISOString(),
  };

  return NextResponse.json(feed, {
    headers: {
      // A live board must not be cached; a finished one can be, since it
      // will not change again.
      "Cache-Control":
        session.status === SessionStatus.LIVE
          ? "no-store"
          : "public, max-age=30",
      // Overlays are served from OBS's own origin, so the browser source
      // needs to be allowed to read this.
      "Access-Control-Allow-Origin": "*",
    },
  });
}
