import { layoutDiagram, type DiagrammableLayout } from "@/lib/track-diagram";
import { primaryImage, type TrackImageLike } from "@/lib/track-images";

/**
 * The picture of a layout.
 *
 * Three states, and the third one matters as much as the first two: a real
 * uploaded map, a generated schematic where the shape is derivable, or an
 * honest blank inviting someone to add a map. The blank is not a failure —
 * it is the correct answer for every road course until a human supplies the
 * survey, and dressing it up with a generated squiggle would be worse than
 * showing nothing.
 */
export function TrackDiagram({
  layout,
  images,
  className,
}: {
  layout: DiagrammableLayout & { id?: string; name: string };
  /** The track's gallery. The best map for this layout is picked from it. */
  images?: readonly TrackImageLike[];
  className?: string;
}) {
  const photo = images
    ? primaryImage(images, layout.id ?? null)
    : null;

  if (photo) {
    return (
      <figure className={className}>
        {/* Deliberately a plain <img>: the URL is user-supplied and points at
            whatever bucket or circuit site holds it, which next/image cannot
            optimise without every host being allow-listed in advance. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={photo.url}
          alt={photo.caption ?? `Map of the ${layout.name} layout`}
          loading="lazy"
          className="w-full rounded-lg border border-brand-black/10 bg-white object-contain"
        />
        {(photo.caption || photo.credit) && (
          <figcaption className="mt-1 text-xs text-brand-black/50">
            {[photo.caption, photo.credit].filter(Boolean).join(" · ")}
          </figcaption>
        )}
      </figure>
    );
  }

  const diagram = layoutDiagram(layout);
  if (!diagram) return null;

  const { arrow } = diagram;
  const tip = arrow.pointsRight ? arrow.x + 11 : arrow.x - 11;
  const tail = arrow.pointsRight ? arrow.x - 11 : arrow.x + 11;
  const barb = arrow.pointsRight ? tip - 6 : tip + 6;

  return (
    <figure className={className}>
      <svg
        viewBox={diagram.viewBox}
        role="img"
        aria-label={diagram.label}
        className="w-full rounded-lg border border-brand-black/10 bg-brand-black/[0.03]"
      >
        <path
          d={diagram.path}
          fill="none"
          stroke="currentColor"
          strokeWidth={9}
          strokeLinejoin="round"
          className="text-brand-black/15"
        />
        <path
          d={diagram.path}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeDasharray="4 4"
          className="text-brand-black/35"
        />
        <g className="text-brand-red" stroke="currentColor" strokeWidth={2}>
          <line x1={tail} y1={arrow.y} x2={tip} y2={arrow.y} />
          <line x1={barb} y1={arrow.y - 4} x2={tip} y2={arrow.y} />
          <line x1={barb} y1={arrow.y + 4} x2={tip} y2={arrow.y} />
        </g>
      </svg>
      <figcaption className="mt-1 text-xs text-brand-black/50">
        Schematic — shape and direction only, not to scale. Upload a real map to
        replace it.
      </figcaption>
    </figure>
  );
}
