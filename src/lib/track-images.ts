import { TrackImageKind } from "@prisma/client";

/**
 * Organising the pictures of a venue.
 *
 * A circuit accumulates several images that are not interchangeable — the
 * official map, an aerial that shows the elevation a map flattens, the paddock
 * plan a transporter driver needs on Thursday morning. This decides which one
 * represents a layout on a card and how the rest are ordered, so the answer is
 * the same on the directory, the track page and anywhere else they surface.
 */

export const TRACK_IMAGE_LABELS: Record<TrackImageKind, string> = {
  MAP: "Track map",
  AERIAL: "Aerial",
  PADDOCK: "Paddock plan",
  PHOTO: "Photo",
};

export const TRACK_IMAGE_DESCRIPTIONS: Record<TrackImageKind, string> = {
  MAP: "The circuit's own layout diagram — corner numbers, pit entry, sectors.",
  AERIAL: "Shot from above. Shows elevation and run-off that a diagram flattens.",
  PADDOCK: "Facility plan: paddock, garages, gates, scrutineering, camping.",
  PHOTO: "A corner, the pit lane, the grid — anything else worth seeing.",
};

/**
 * Display order.
 *
 * A map first because it is what somebody opening a layout came for; photos
 * last because they are the ones you browse rather than consult.
 */
export const TRACK_IMAGE_ORDER: readonly TrackImageKind[] = [
  TrackImageKind.MAP,
  TrackImageKind.AERIAL,
  TrackImageKind.PADDOCK,
  TrackImageKind.PHOTO,
];

export interface TrackImageLike {
  id: string;
  kind: TrackImageKind;
  url: string;
  caption?: string | null;
  credit?: string | null;
  position: number;
  layoutId?: string | null;
}

/** Position first, then kind, then id — total, so rendering never reshuffles. */
function compare(a: TrackImageLike, b: TrackImageLike): number {
  if (a.position !== b.position) return a.position - b.position;
  const byKind =
    TRACK_IMAGE_ORDER.indexOf(a.kind) - TRACK_IMAGE_ORDER.indexOf(b.kind);
  if (byKind !== 0) return byKind;
  return a.id.localeCompare(b.id);
}

/** Every image attached to one layout, in display order. */
export function imagesForLayout<T extends TrackImageLike>(
  images: readonly T[],
  layoutId: string,
): T[] {
  return images.filter((image) => image.layoutId === layoutId).sort(compare);
}

/**
 * Images that describe the facility rather than a configuration.
 *
 * These are the ones with no `layoutId`. A paddock plan does not belong to the
 * Grand Prix circuit any more than it belongs to the club circuit.
 */
export function imagesForFacility<T extends TrackImageLike>(
  images: readonly T[],
): T[] {
  return images.filter((image) => !image.layoutId).sort(compare);
}

/**
 * The one image that stands for a layout on a card.
 *
 * A real map beats an aerial beats anything else, because a card is small and
 * a map is the only kind that stays legible at thumbnail size. Returns null
 * when there is nothing, which is what lets the caller fall back to a
 * generated schematic or to an invitation to upload one.
 */
export function primaryImage<T extends TrackImageLike>(
  images: readonly T[],
  layoutId?: string | null,
): T | null {
  const scope = layoutId
    ? imagesForLayout(images, layoutId)
    : imagesForFacility(images);
  for (const kind of TRACK_IMAGE_ORDER) {
    const match = scope.find((image) => image.kind === kind);
    if (match) return match;
  }
  return null;
}

/**
 * The position to give a newly added image so it lands at the end.
 *
 * Appending rather than prepending: somebody who has arranged their gallery
 * should not have it reordered by the next upload.
 */
export function nextPosition(images: readonly TrackImageLike[]): number {
  if (images.length === 0) return 0;
  return Math.max(...images.map((image) => image.position)) + 1;
}

/**
 * Positions after moving one image one step.
 *
 * Returns the full list of `{id, position}` to write rather than a swap, so
 * the caller can persist it in one transaction and a gallery that has drifted
 * into duplicate positions comes back normalised rather than staying stuck.
 */
export function reorder<T extends TrackImageLike>(
  images: readonly T[],
  id: string,
  direction: "up" | "down",
): { id: string; position: number }[] {
  const sorted = [...images].sort(compare);
  const index = sorted.findIndex((image) => image.id === id);
  if (index === -1) return [];

  const target = direction === "up" ? index - 1 : index + 1;
  // Already at the end it is being pushed towards: nothing to write.
  if (target < 0 || target >= sorted.length) return [];

  [sorted[index], sorted[target]] = [sorted[target], sorted[index]];
  return sorted.map((image, position) => ({ id: image.id, position }));
}

/**
 * Whether a caption reads as a credit that was pasted into the wrong box.
 *
 * Not enforcement — a hint. People type "© Circuit of the Americas" into
 * whichever field they meet first, and an attribution buried in a caption is
 * an attribution nobody can render as one.
 */
export function looksLikeCredit(caption: string): boolean {
  return /©|\(c\)\s|copyright|\ball rights reserved\b/i.test(caption);
}
