import { describe, expect, it } from "vitest";
import { TrackImageKind } from "@prisma/client";
import {
  imagesForFacility,
  imagesForLayout,
  looksLikeCredit,
  nextPosition,
  primaryImage,
  reorder,
  TRACK_IMAGE_DESCRIPTIONS,
  TRACK_IMAGE_LABELS,
  TRACK_IMAGE_ORDER,
  type TrackImageLike,
} from "@/lib/track-images";

function image(
  id: string,
  overrides: Partial<TrackImageLike> = {},
): TrackImageLike {
  return {
    id,
    kind: TrackImageKind.PHOTO,
    url: `https://example.test/${id}.jpg`,
    position: 0,
    layoutId: null,
    ...overrides,
  };
}

describe("image kinds", () => {
  it("labels and describes every kind", () => {
    for (const kind of Object.values(TrackImageKind)) {
      expect(TRACK_IMAGE_LABELS[kind], kind).toBeTruthy();
      expect(TRACK_IMAGE_DESCRIPTIONS[kind], kind).toBeTruthy();
    }
  });

  it("orders every kind exactly once, map first", () => {
    expect([...TRACK_IMAGE_ORDER].sort()).toEqual(
      Object.values(TrackImageKind).sort(),
    );
    expect(TRACK_IMAGE_ORDER[0]).toBe(TrackImageKind.MAP);
  });
});

describe("scoping", () => {
  const images = [
    image("a", { layoutId: "L1" }),
    image("b", { layoutId: "L2" }),
    image("c"),
  ];

  it("splits a layout's images from the facility's", () => {
    // A paddock plan belongs to the venue, not to the Grand Prix circuit any
    // more than to the club circuit — hence the null layoutId.
    expect(imagesForLayout(images, "L1").map((i) => i.id)).toEqual(["a"]);
    expect(imagesForFacility(images).map((i) => i.id)).toEqual(["c"]);
  });

  it("returns nothing for a layout with no images", () => {
    expect(imagesForLayout(images, "L9")).toEqual([]);
  });
});

describe("ordering", () => {
  it("sorts by position first", () => {
    const images = [
      image("late", { position: 2 }),
      image("first", { position: 0 }),
      image("mid", { position: 1 }),
    ];
    expect(imagesForFacility(images).map((i) => i.id)).toEqual([
      "first",
      "mid",
      "late",
    ]);
  });

  it("breaks a position tie by kind, then by id", () => {
    // Duplicate positions happen — two clients adding at once. The order must
    // still be total, or a re-render reshuffles the gallery under someone.
    const images = [
      image("z", { kind: TrackImageKind.PHOTO }),
      image("y", { kind: TrackImageKind.MAP }),
      image("x", { kind: TrackImageKind.PHOTO }),
    ];
    expect(imagesForFacility(images).map((i) => i.id)).toEqual(["y", "x", "z"]);
  });

  it("does not mutate its input", () => {
    const images = [image("b", { position: 1 }), image("a", { position: 0 })];
    imagesForFacility(images);
    expect(images[0].id).toBe("b");
  });
});

describe("primaryImage", () => {
  it("prefers a map over anything else, whatever the order", () => {
    // A card is small, and a map is the only kind that stays legible at
    // thumbnail size.
    const images = [
      image("photo", { layoutId: "L1", position: 0 }),
      image("aerial", { layoutId: "L1", position: 1, kind: TrackImageKind.AERIAL }),
      image("map", { layoutId: "L1", position: 2, kind: TrackImageKind.MAP }),
    ];
    expect(primaryImage(images, "L1")?.id).toBe("map");
  });

  it("falls back to an aerial, then to anything", () => {
    const aerial = [
      image("photo", { layoutId: "L1" }),
      image("aerial", { layoutId: "L1", kind: TrackImageKind.AERIAL }),
    ];
    expect(primaryImage(aerial, "L1")?.id).toBe("aerial");
    expect(primaryImage([image("photo", { layoutId: "L1" })], "L1")?.id).toBe(
      "photo",
    );
  });

  it("is null when there is nothing, which is what enables the fallback", () => {
    // Null is how the renderer knows to draw a schematic or invite an upload
    // instead of showing a broken frame.
    expect(primaryImage([], "L1")).toBeNull();
    expect(primaryImage([image("a", { layoutId: "L2" })], "L1")).toBeNull();
  });

  it("does not hand a facility image to a layout, or the reverse", () => {
    const images = [
      image("facility", { kind: TrackImageKind.PADDOCK }),
      image("layout", { layoutId: "L1", kind: TrackImageKind.MAP }),
    ];
    expect(primaryImage(images, "L1")?.id).toBe("layout");
    expect(primaryImage(images, null)?.id).toBe("facility");
  });
});

describe("nextPosition", () => {
  it("appends rather than prepends", () => {
    // Somebody who has arranged their gallery should not have it reordered by
    // the next upload.
    expect(nextPosition([image("a", { position: 0 }), image("b", { position: 3 })])).toBe(4);
  });

  it("starts at zero on an empty gallery", () => {
    expect(nextPosition([])).toBe(0);
  });
});

describe("reorder", () => {
  const images = [
    image("a", { position: 0 }),
    image("b", { position: 1 }),
    image("c", { position: 2 }),
  ];

  it("moves one step up", () => {
    expect(reorder(images, "b", "up")).toEqual([
      { id: "b", position: 0 },
      { id: "a", position: 1 },
      { id: "c", position: 2 },
    ]);
  });

  it("moves one step down", () => {
    expect(reorder(images, "b", "down")).toEqual([
      { id: "a", position: 0 },
      { id: "c", position: 1 },
      { id: "b", position: 2 },
    ]);
  });

  it("does nothing at either end", () => {
    expect(reorder(images, "a", "up")).toEqual([]);
    expect(reorder(images, "c", "down")).toEqual([]);
  });

  it("does nothing for an id that is not there", () => {
    expect(reorder(images, "nope", "up")).toEqual([]);
  });

  it("normalises positions that have drifted", () => {
    // Two clients appending at once can leave duplicates. Rewriting the whole
    // sequence means one reorder unsticks a gallery that had gone ambiguous.
    const drifted = [
      image("a", { position: 5 }),
      image("b", { position: 5 }),
      image("c", { position: 5 }),
    ];
    const moves = reorder(drifted, "c", "up");
    expect(moves.map((m) => m.position)).toEqual([0, 1, 2]);
    expect(moves.map((m) => m.id)).toEqual(["a", "c", "b"]);
  });
});

describe("looksLikeCredit", () => {
  it("spots an attribution typed into the caption box", () => {
    // People type "© Circuit of the Americas" into whichever field they meet
    // first, and an attribution buried in a caption cannot render as one.
    expect(looksLikeCredit("© Circuit of the Americas")).toBe(true);
    expect(looksLikeCredit("Copyright 2026 the circuit")).toBe(true);
    expect(looksLikeCredit("All rights reserved")).toBe(true);
  });

  it("leaves an ordinary caption alone", () => {
    expect(looksLikeCredit("2024 configuration, after the T5 repave")).toBe(false);
    expect(looksLikeCredit("")).toBe(false);
  });
});
