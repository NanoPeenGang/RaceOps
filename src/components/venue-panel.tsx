"use client";

import { useState } from "react";
import Link from "next/link";
import { api } from "@/lib/trpc/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatLength, layoutLabel, turnLabel } from "@/lib/tracks";

/**
 * Links an event to a track layout.
 *
 * Free-text venue stays supported — a hillclimb on someone's estate has no
 * Track record and does not need one — but choosing a layout is what turns on
 * corner-referenced incidents and puts the meeting's lap times into the
 * venue's records.
 */
export function VenuePanel({ eventId }: { eventId: string }) {
  const utils = api.useUtils();
  const event = api.event.byId.useQuery({ eventId });
  const [query, setQuery] = useState("");
  const [picking, setPicking] = useState(false);

  const tracks = api.track.list.useQuery(
    { query: query.trim() || undefined, limit: 10 },
    { enabled: picking },
  );

  const update = api.event.update.useMutation({
    onSuccess: async () => {
      await utils.event.byId.invalidate({ eventId });
      setPicking(false);
    },
  });

  const layout = event.data?.trackLayout;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-semibold">Venue</h2>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setPicking((open) => !open)}
        >
          {picking ? "Cancel" : layout ? "Change track" : "Link a track"}
        </Button>
      </div>

      <Card>
        <CardContent className="space-y-3 p-4">
          {layout ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`/tracks/${layout.track.slug}`}
                  className="font-medium hover:text-brand-red"
                >
                  {layoutLabel(layout)}
                </Link>
                {formatLength(layout.lengthMeters) && (
                  <Badge variant="outline">
                    {formatLength(layout.lengthMeters)}
                  </Badge>
                )}
              </div>
              {layout.turns.length > 0 ? (
                <div>
                  <p className="text-xs text-brand-black/60">
                    {layout.turns.length} corner
                    {layout.turns.length === 1 ? "" : "s"} defined — incident
                    reports at this event can name one.
                  </p>
                  <ul className="mt-2 flex flex-wrap gap-1.5">
                    {layout.turns.map((turn) => (
                      <li
                        key={turn.id}
                        className="rounded-full bg-brand-black/5 px-2.5 py-0.5 text-xs"
                      >
                        {turnLabel(turn)}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-xs text-brand-black/60">
                  No corners defined on this layout yet. Add them on the{" "}
                  <Link
                    href={`/tracks/${layout.track.slug}`}
                    className="text-brand-red hover:underline"
                  >
                    track page
                  </Link>{" "}
                  and marshals can report by corner instead of free text.
                </p>
              )}
              <Button
                size="sm"
                variant="outline"
                disabled={update.isPending}
                onClick={() => update.mutate({ eventId, trackLayoutId: null })}
              >
                Unlink
              </Button>
            </>
          ) : (
            <p className="text-sm text-brand-black/60">
              {event.data?.venue
                ? `Free text: “${event.data.venue}”. `
                : "No venue set. "}
              Linking a track layout enables corner-referenced incidents and
              adds this meeting&rsquo;s laps to the venue&rsquo;s records.
            </p>
          )}

          {picking && (
            <div className="space-y-3 border-t border-brand-black/10 pt-3">
              <input
                className="w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
                placeholder="Search tracks"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {tracks.data?.items.length === 0 && (
                <p className="text-sm text-brand-black/60">
                  No match.{" "}
                  <Link href="/tracks" className="text-brand-red hover:underline">
                    Add the track
                  </Link>{" "}
                  and come back.
                </p>
              )}
              <ul className="space-y-2">
                {tracks.data?.items.map((track) => (
                  <li key={track.id} className="space-y-1">
                    <p className="text-sm font-medium">{track.name}</p>
                    <div className="flex flex-wrap gap-2">
                      {track.layouts.map((option) => (
                        <Button
                          key={option.id}
                          size="sm"
                          variant="outline"
                          disabled={update.isPending}
                          onClick={() =>
                            update.mutate({ eventId, trackLayoutId: option.id })
                          }
                        >
                          {option.name}
                          {option.platform ? ` (${option.platform})` : ""}
                        </Button>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {update.error && (
            <p className="text-sm text-brand-red">{update.error.message}</p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
