import Link from "next/link";
import { LayoutShape, TrackDirection, TrackImageKind } from "@prisma/client";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { TrackDiagram } from "@/components/track-diagram";
import { placeLabel } from "@/lib/regions";
import {
  formatBanking,
  formatTurns,
  shapeLabel,
  venueMapUrl,
} from "@/lib/track-diagram";
import { formatLength, TRACK_DIRECTION_LABELS } from "@/lib/tracks";

/**
 * The venue, on the event's own page.
 *
 * Somebody reading this is deciding whether to enter and what to put in the
 * trailer, and "Road America" alone does not answer that. The configuration
 * being run is the thing that matters — a 4.048-km full course and a 3.2-km
 * club course are different weekends — so the layout gets its map, its
 * figures, and the circuit's *other* configurations listed beside it. Without
 * the siblings, a label like "Full Course" is unexplained; with them it is
 * visibly one of four, and nobody turns up having practised the wrong one.
 */

interface LayoutSummary {
  id: string;
  name: string;
  platform: string | null;
  lengthMeters: number | null;
  turnCount: number | null;
  direction: TrackDirection;
  shape: LayoutShape | null;
  bankingDegrees: number | null;
  isPrimary: boolean;
}

export interface EventVenueLayout {
  id: string;
  name: string;
  platform: string | null;
  lengthMeters: number | null;
  direction: TrackDirection;
  turnCount: number | null;
  shape: LayoutShape | null;
  bankingDegrees: number | null;
  elevationMeters: number | null;
  turns: { id: string }[];
  track: {
    id: string;
    name: string;
    slug: string;
    city: string | null;
    region: string | null;
    country: string | null;
    latitude: number | null;
    longitude: number | null;
    websiteUrl: string | null;
    images: {
      id: string;
      url: string;
      kind: TrackImageKind;
      caption: string | null;
      credit: string | null;
      position: number;
      layoutId: string | null;
    }[];
    layouts: LayoutSummary[];
  };
}

export function EventVenue({ layout }: { layout: EventVenueLayout }) {
  const { track } = layout;
  const others = track.layouts.filter((option) => option.id !== layout.id);

  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold">Venue</h2>

      <Card>
        <CardContent className="space-y-5 p-4">
          <div className="grid gap-5 sm:grid-cols-[minmax(0,260px)_1fr]">
            <div>
              <TrackDiagram layout={layout} images={track.images} />
            </div>

            <div className="space-y-3">
              <div>
                <p className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/tracks/${track.slug}`}
                    className="text-lg font-semibold hover:text-brand-red"
                  >
                    {track.name}
                  </Link>
                  <Badge variant="verified">{layout.name}</Badge>
                  {layout.platform && (
                    <Badge variant="outline">{layout.platform}</Badge>
                  )}
                </p>
                <p className="text-sm text-brand-black/60">
                  {placeLabel(track) ?? "Location not given"}
                </p>
              </div>

              <dl className="grid max-w-xl grid-cols-2 gap-x-6 gap-y-3 text-xs sm:grid-cols-3">
                <Spec label="Length" value={formatLength(layout.lengthMeters)} />
                <Spec label="Turns" value={formatTurns(layout.turnCount)} />
                <Spec
                  label="Direction"
                  value={TRACK_DIRECTION_LABELS[layout.direction]}
                />
                <Spec
                  label="Banking"
                  value={formatBanking(layout.bankingDegrees)}
                />
                <Spec
                  label="Shape"
                  value={layout.shape ? shapeLabel(layout.shape) : null}
                />
                <Spec
                  label="Elevation"
                  value={
                    layout.elevationMeters ? `${layout.elevationMeters} m` : null
                  }
                />
              </dl>

              <p className="flex flex-wrap items-center gap-3 text-xs">
                <Link
                  href={`/tracks/${track.slug}`}
                  className="text-brand-red hover:underline"
                >
                  Track page, photos & facility rules →
                </Link>
                <a
                  href={venueMapUrl({ ...track, name: track.name })}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-brand-red hover:underline"
                >
                  Open in maps ↗
                </a>
                {track.websiteUrl && (
                  <a
                    href={track.websiteUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-brand-red hover:underline"
                  >
                    Circuit website ↗
                  </a>
                )}
              </p>
            </div>
          </div>

          {others.length > 0 && (
            <div className="space-y-2 border-t border-brand-black/10 pt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-brand-black/50">
                Other layouts at this circuit — not in use for this event
              </p>
              <ul className="grid gap-2 sm:grid-cols-2">
                {others.map((option) => (
                  <li
                    key={option.id}
                    className="flex flex-wrap items-baseline justify-between gap-2 rounded-md border border-brand-black/10 px-3 py-2 text-sm"
                  >
                    <span>
                      {option.name}
                      {option.platform ? ` (${option.platform})` : ""}
                    </span>
                    <span className="text-xs tabular-nums text-brand-black/55">
                      {[
                        formatLength(option.lengthMeters),
                        formatTurns(option.turnCount),
                      ]
                        .filter(Boolean)
                        .join(" · ") || "No figures yet"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

/** One figure. Renders nothing at all when it is not known. */
function Spec({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div>
      <dt className="font-semibold uppercase tracking-wide text-brand-black/45">
        {label}
      </dt>
      <dd className="tabular-nums text-brand-black/80">{value}</dd>
    </div>
  );
}
