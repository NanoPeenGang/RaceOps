"use client";

import { useState } from "react";
import { TrackImageKind } from "@prisma/client";
import { api } from "@/lib/trpc/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ImageUpload } from "@/components/image-upload";
import {
  looksLikeCredit,
  TRACK_IMAGE_DESCRIPTIONS,
  TRACK_IMAGE_LABELS,
  TRACK_IMAGE_ORDER,
  type TrackImageLike,
} from "@/lib/track-images";

/**
 * Photographs and maps for one track, or for one layout of it.
 *
 * Deliberately visible on the page rather than tucked inside an editor panel.
 * The platform will not draw a road course's outline — that is survey data, not
 * something derivable from a length and a turn count — so an uploaded map is
 * the *only* way most circuits here ever get a picture. A control nobody finds
 * leaves that gap open permanently.
 */
export function TrackGallery({
  trackId,
  layoutId,
  images,
  canCurate,
  onChanged,
  title,
  description,
}: {
  trackId: string;
  /** Null for facility images: a paddock plan is not one layout's. */
  layoutId?: string | null;
  images: (TrackImageLike & {
    uploadedBy?: { profile: { displayName: string } | null } | null;
  })[];
  canCurate: boolean;
  onChanged: () => void;
  title: string;
  description: string;
}) {
  const [adding, setAdding] = useState(false);
  const move = api.track.moveImage.useMutation({
    meta: { silenceError: true },
    onSuccess: onChanged,
  });
  const remove = api.track.deleteImage.useMutation({ onSuccess: onChanged });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium">{title}</p>
          <p className="text-xs text-brand-black/60">{description}</p>
        </div>
        {canCurate && (
          <Button
            size="sm"
            variant={images.length === 0 ? "primary" : "outline"}
            onClick={() => setAdding((open) => !open)}
          >
            {adding
              ? "Cancel"
              : images.length === 0
                ? "Add a photo"
                : "Add another"}
          </Button>
        )}
      </div>

      {adding && (
        <ImageForm
          trackId={trackId}
          layoutId={layoutId}
          onSaved={() => {
            setAdding(false);
            onChanged();
          }}
        />
      )}

      {images.length === 0 && !adding && (
        <p className="rounded-lg border border-dashed border-brand-black/20 p-5 text-center text-xs text-brand-black/50">
          {canCurate
            ? "Nothing here yet. A photo of the official map, or an aerial, is the most useful thing you can add."
            : "No photos yet. Sign in to add one."}
        </p>
      )}

      {images.length > 0 && (
        <ul className="grid gap-4 sm:grid-cols-2">
          {images.map((image, index) => (
            <li
              key={image.id}
              className="space-y-2 rounded-lg border border-brand-black/10 p-3"
            >
              {/* White in both themes — see track-diagram: these are line-art maps. */}
              <div className="overflow-hidden rounded bg-white">
                {/* User-supplied URLs on arbitrary hosts; next/image cannot
                    optimise those without allow-listing each one. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={image.url}
                  alt={image.caption ?? TRACK_IMAGE_LABELS[image.kind]}
                  loading="lazy"
                  className="max-h-72 w-full object-contain"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">
                  {TRACK_IMAGE_LABELS[image.kind]}
                </Badge>
                {image.caption && (
                  <span className="text-xs text-brand-black/75">
                    {image.caption}
                  </span>
                )}
              </div>

              <p className="text-xs text-brand-black/50">
                {image.credit ? (
                  <span>{image.credit}</span>
                ) : (
                  <span className="italic">No credit given</span>
                )}
                {image.uploadedBy?.profile?.displayName && (
                  <span>
                    {" "}
                    · added by {image.uploadedBy.profile.displayName}
                  </span>
                )}
              </p>

              {canCurate && (
                <div className="flex flex-wrap items-center gap-2 border-t border-brand-black/10 pt-2 text-xs">
                  <button
                    type="button"
                    className="disabled:opacity-30 hover:text-brand-black"
                    disabled={index === 0 || move.isPending}
                    onClick={() =>
                      move.mutate({ imageId: image.id, direction: "up" })
                    }
                  >
                    ← Earlier
                  </button>
                  <button
                    type="button"
                    className="disabled:opacity-30 hover:text-brand-black"
                    disabled={index === images.length - 1 || move.isPending}
                    onClick={() =>
                      move.mutate({ imageId: image.id, direction: "down" })
                    }
                  >
                    Later →
                  </button>
                  <a
                    href={image.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-brand-black/60 hover:text-brand-black"
                  >
                    Open full size ↗
                  </a>
                  <button
                    type="button"
                    className="ml-auto text-brand-red hover:underline"
                    onClick={() => remove.mutate({ imageId: image.id })}
                  >
                    Remove
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {(move.error || remove.error) && (
        <p className="text-sm text-brand-red">
          {move.error?.message ?? remove.error?.message}
        </p>
      )}
    </div>
  );
}

function ImageForm({
  trackId,
  layoutId,
  onSaved,
}: {
  trackId: string;
  layoutId?: string | null;
  onSaved: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [kind, setKind] = useState<TrackImageKind>(
    // A facility image is far more often a paddock plan than a layout map.
    layoutId ? TrackImageKind.MAP : TrackImageKind.PADDOCK,
  );
  const [caption, setCaption] = useState("");
  const [credit, setCredit] = useState("");
  const add = api.track.addImage.useMutation({ onSuccess: onSaved });

  const creditInCaption = looksLikeCredit(caption) && !credit.trim();

  return (
    <div className="space-y-3 rounded-lg border border-brand-black/10 p-4">
      <ImageUpload
        purpose="diagram"
        aspect="map"
        value={url}
        onChange={setUrl}
        label="Photo or map"
        hint="Take a photo of the map on the wall, upload the circuit's PDF export as an image, or paste a link."
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs font-medium">
          What it shows
          <select
            className="mt-1 w-full rounded-md border border-brand-black/20 px-2 py-1.5 text-sm"
            value={kind}
            onChange={(e) => setKind(e.target.value as TrackImageKind)}
          >
            {TRACK_IMAGE_ORDER.map((value) => (
              <option key={value} value={value}>
                {TRACK_IMAGE_LABELS[value]}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-brand-black/55">
            {TRACK_IMAGE_DESCRIPTIONS[kind]}
          </span>
        </label>
        <label className="block text-xs font-medium">
          Caption
          <input
            className="mt-1 w-full rounded-md border border-brand-black/20 px-2 py-1.5 text-sm"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="2024 configuration, after the T5 repave"
          />
        </label>
      </div>

      <label className="block text-xs font-medium">
        Credit
        <input
          className="mt-1 w-full rounded-md border border-brand-black/20 px-2 py-1.5 text-sm"
          value={credit}
          onChange={(e) => setCredit(e.target.value)}
          placeholder="Whose image this is — the circuit, a photographer, you"
        />
        <span className="mt-1 block text-brand-black/55">
          Most circuit maps belong to the circuit. Say whose it is; hosting
          someone else&rsquo;s work without attribution is not yours to do.
        </span>
      </label>

      {creditInCaption && (
        <p className="text-xs text-brand-black/70">
          That caption looks like an attribution — putting it in the credit box
          means it renders as one.
        </p>
      )}
      {add.error && (
        <p className="text-sm text-brand-red">{add.error.message}</p>
      )}

      <Button
        size="sm"
        variant="primary"
        disabled={!url || add.isPending}
        onClick={() =>
          url &&
          add.mutate({
            trackId,
            layoutId: layoutId ?? null,
            kind,
            url,
            caption: caption.trim() || undefined,
            credit: credit.trim() || undefined,
          })
        }
      >
        {add.isPending ? "Saving…" : "Add to the track"}
      </Button>
    </div>
  );
}
