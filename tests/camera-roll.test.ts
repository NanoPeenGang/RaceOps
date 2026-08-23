import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkUpload,
  describeTypes,
  isAllowedType,
  needsTranscode,
  TRANSCODE_TYPES,
  UPLOAD_RULES,
  type UploadPurpose,
} from "@/lib/upload";

const IMAGE_PURPOSES: UploadPurpose[] = ["avatar", "logo", "banner", "diagram", "media"];

describe("what the picker offers", () => {
  it("names HEIC everywhere a photo can go", () => {
    /*
     * The reason a camera roll looked empty: an iPhone writes HEIC, and a
     * picker whose accept list does not name it greys out every photo the
     * person is looking at.
     */
    for (const purpose of IMAGE_PURPOSES) {
      expect(UPLOAD_RULES[purpose].accept).toContain("image/heic");
      expect(UPLOAD_RULES[purpose].accept).toContain("image/heif");
    }
  });

  it("names the extensions too, for the platforms that send no MIME type", () => {
    for (const purpose of IMAGE_PURPOSES) {
      expect(UPLOAD_RULES[purpose].accept).toContain(".heic");
    }
  });

  it("still offers the ordinary formats", () => {
    for (const purpose of IMAGE_PURPOSES) {
      expect(UPLOAD_RULES[purpose].accept).toContain("image/jpeg");
      expect(UPLOAD_RULES[purpose].accept).toContain("image/png");
    }
  });

  it("offers more than it stores, and only for photos", () => {
    for (const purpose of IMAGE_PURPOSES) {
      expect(UPLOAD_RULES[purpose].accept.length).toBeGreaterThan(
        UPLOAD_RULES[purpose].store.length,
      );
    }
    // A telemetry file or a PDF has no camera format to accommodate.
    expect(UPLOAD_RULES.garage.accept).toEqual(UPLOAD_RULES.garage.store);
    expect(UPLOAD_RULES.document.accept).toEqual(UPLOAD_RULES.document.store);
  });
});

describe("what may actually be stored", () => {
  it("refuses HEIC, because it renders in Safari and nowhere else", () => {
    for (const purpose of IMAGE_PURPOSES) {
      for (const type of TRANSCODE_TYPES) {
        expect(isAllowedType(purpose, type)).toBe(false);
      }
    }
  });

  it("never offers an SVG, which can carry script", () => {
    for (const purpose of IMAGE_PURPOSES) {
      expect(UPLOAD_RULES[purpose].accept).not.toContain("image/svg+xml");
      expect(UPLOAD_RULES[purpose].store).not.toContain("image/svg+xml");
    }
  });

  it("describes the storable list in an error, not the picker's", () => {
    // Otherwise a rejection message would offer HEIC as a way to fix itself.
    const message = checkUpload("avatar", { type: "image/tiff", size: 100 })!.message;
    expect(message).not.toMatch(/heic/i);
    expect(message).toMatch(/JPEG/);
  });

  it("still catches a file that is simply too big", () => {
    const rejection = checkUpload("avatar", {
      type: "image/jpeg",
      size: UPLOAD_RULES.avatar.maxBytes + 1,
    });
    expect(rejection?.reason).toBe("size");
  });

  it("names every storable type in plain English", () => {
    for (const purpose of IMAGE_PURPOSES) {
      const described = describeTypes(UPLOAD_RULES[purpose].store);
      expect(described).not.toMatch(/image\//);
    }
  });
});

describe("needsTranscode", () => {
  it("spots the camera formats by type", () => {
    for (const type of TRANSCODE_TYPES) {
      expect(needsTranscode({ type })).toBe(true);
    }
  });

  it("spots them by extension when the browser reports nothing useful", () => {
    /*
     * Windows and some Android builds hand over a `.heic` with an empty type
     * or as octet-stream. Matching only on the MIME type would send those
     * straight to the bucket as-is.
     */
    expect(needsTranscode({ type: "", name: "IMG_4021.HEIC" })).toBe(true);
    expect(needsTranscode({ type: "application/octet-stream", name: "a.heif" })).toBe(true);
  });

  it("leaves ordinary photos alone", () => {
    expect(needsTranscode({ type: "image/jpeg", name: "IMG_4021.JPG" })).toBe(false);
    expect(needsTranscode({ type: "image/png", name: "shot.png" })).toBe(false);
    expect(needsTranscode({ type: "video/quicktime", name: "lap.mov" })).toBe(false);
  });

  it("is not fooled by a name that merely mentions one", () => {
    expect(needsTranscode({ type: "image/jpeg", name: "heic-comparison.jpg" })).toBe(false);
  });
});

describe("the pickers themselves", () => {
  const photoUpload = readFileSync(
    join(process.cwd(), "src/components/photo-upload.tsx"),
    "utf8",
  );
  const imageUpload = readFileSync(
    join(process.cwd(), "src/components/image-upload.tsx"),
    "utf8",
  );

  it("never sets capture, which would replace the camera roll with the camera", () => {
    /*
     * The trap this whole change is about. `capture` reads like the attribute
     * you want for a phone and does the opposite: it tells the browser to open
     * the camera *instead of* the library, so a photo taken last weekend
     * becomes unreachable.
     */
    for (const source of [photoUpload, imageUpload]) {
      expect(source).not.toMatch(/\bcapture\s*(=|\/>)/);
      expect(source).not.toContain('capture="environment"');
    }
  });

  it("lets you pick more than one photo where photos are plural", () => {
    expect(photoUpload).toContain("multiple");
  });

  it("keeps the single-value picker single", () => {
    // A logo field taking twelve files would have to silently drop eleven.
    expect(imageUpload).not.toContain("multiple");
  });

  it("checks the type only after converting", () => {
    /*
     * Both pickers reject an unusable file early, which is right — but a HEIC
     * is only unusable until it has been converted, and checking it first
     * would refuse exactly the photos this exists to accept.
     */
    expect(imageUpload).toContain("if (!needsTranscode(file))");
    const before = photoUpload.indexOf("await prepareUpload");
    const after = photoUpload.indexOf("checkUpload(purpose", before);
    expect(before).toBeGreaterThan(-1);
    expect(after).toBeGreaterThan(before);
  });

  it("uploads one at a time, so a dropped connection keeps what landed", () => {
    expect(photoUpload).toContain("for (const [index, file] of picked.entries())");
    expect(photoUpload).toContain("await uploadOne");
  });
});

describe("the media gallery", () => {
  const panel = readFileSync(join(process.cwd(), "src/components/media-panel.tsx"), "utf8");

  it("offers a file picker, not only a URL box", () => {
    // It used to ask for a link and nothing else, which meant uploading the
    // photo somewhere else first and coming back with a URL.
    expect(panel).toContain("<PhotoUpload");
  });

  it("keeps attach-by-link as well", () => {
    expect(panel).toContain("Media URL");
  });

  it("does not close the form on the first photo of a batch", () => {
    const success = panel.slice(panel.indexOf("onSuccess:"), panel.indexOf("const remove"));
    expect(success).not.toContain("setShowForm(false)");
  });
});
