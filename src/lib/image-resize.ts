"use client";

import {
  needsTranscode,
  scaleToFit,
  type UploadPurpose,
  UPLOAD_RULES,
} from "@/lib/upload";

/**
 * Downscaling a picked image before it is uploaded.
 *
 * A phone camera produces a 12-megapixel, 6 MB JPEG. A logo needs 512 pixels.
 * Uploading the original over circuit wifi is the difference between a feature
 * people use trackside and one they give up on, so the resize happens in the
 * browser before a single byte is sent.
 *
 * It also converts, which is a separate job from resizing. An iPhone writes
 * HEIC, and a HEIC in the bucket renders in Safari and nowhere else — so a
 * camera-roll photo becomes a JPEG here even when it is already small enough
 * that no downscale is wanted.
 *
 * Browser-only: it needs canvas. The server enforces the same size caps
 * independently, because a rule enforced only on the client is not a rule.
 */

/**
 * A picked file this browser cannot decode.
 *
 * Its own error type because the caller has to say something specific and
 * actionable: every other failure here falls back to uploading the original,
 * and this one cannot, since the original is a format the bucket will refuse.
 */
export class UndecodableImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UndecodableImageError";
  }
}

export interface ResizeResult {
  blob: Blob;
  contentType: string;
  width: number;
  height: number;
  /** True when the original was already small enough and is sent untouched. */
  untouched: boolean;
}

/**
 * Resizes if needed, otherwise hands the original straight back.
 *
 * Falls back to the original on any failure rather than blocking the upload:
 * a photo that uploads at full size is a slow success, and a resize error that
 * stops the upload is a failure. Videos and PDFs are never touched.
 */
export async function prepareUpload(
  file: File,
  purpose: UploadPurpose,
): Promise<ResizeResult> {
  const original: ResizeResult = {
    blob: file,
    contentType: file.type,
    width: 0,
    height: 0,
    untouched: true,
  };

  const maxEdge = UPLOAD_RULES[purpose].maxEdge;

  /*
   * Converting and resizing are different jobs with different triggers. A
   * paddock photo is stored at full resolution on purpose, but if it came off
   * an iPhone it still has to stop being a HEIC first.
   */
  const mustConvert = needsTranscode(file);
  if (mustConvert) return transcode(file, maxEdge);

  if (!maxEdge || !file.type.startsWith("image/")) return original;
  // An animated GIF re-encoded through a canvas becomes a single still frame,
  // which is a silent, surprising loss of the thing someone uploaded.
  if (file.type === "image/gif") return original;

  try {
    const bitmap = await createImageBitmap(file);
    const target = scaleToFit(bitmap.width, bitmap.height, maxEdge);
    if (!target) {
      // Already within bounds. Re-encoding would only lose quality.
      bitmap.close?.();
      return { ...original, width: bitmap.width, height: bitmap.height };
    }

    const canvas = document.createElement("canvas");
    canvas.width = target.width;
    canvas.height = target.height;
    const context = canvas.getContext("2d");
    if (!context) return original;
    context.drawImage(bitmap, 0, 0, target.width, target.height);
    bitmap.close?.();

    // PNG keeps transparency, which matters for a logo; everything else goes
    // to JPEG, which is dramatically smaller for a photograph.
    const outputType = file.type === "image/png" ? "image/png" : "image/jpeg";
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, outputType, 0.85),
    );
    if (!blob) return original;

    // A resize that made the file bigger — small PNGs sometimes do — is not
    // an improvement; send whichever is actually smaller.
    if (blob.size >= file.size) {
      return { ...original, width: bitmap.width, height: bitmap.height };
    }

    return {
      blob,
      contentType: outputType,
      width: target.width,
      height: target.height,
      untouched: false,
    };
  } catch {
    return original;
  }
}

/**
 * Turn a camera format into a JPEG.
 *
 * Safari decodes HEIC natively because it is an Apple format; Chrome and
 * Firefox do not, and there is no fallback that does not mean shipping a
 * decoder to every visitor. So this either works or says why in a sentence
 * somebody can act on — which is better than the alternative, where the
 * upload fails later with "must be a JPEG, PNG, WebP, AVIF or GIF" about a
 * photo the person is looking at in their camera roll.
 */
async function transcode(file: File, maxEdge: number | null): Promise<ResizeResult> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new UndecodableImageError(
      "This browser cannot read HEIC photos. Open the site in Safari, or set " +
        "iPhone Settings \u2192 Camera \u2192 Formats to \u201cMost Compatible\u201d and take the " +
        "photo again.",
    );
  }

  // Convert first, resize only if the purpose asks for it — the same rule the
  // rest of this file follows.
  const target = scaleToFit(bitmap.width, bitmap.height, maxEdge) ?? {
    width: bitmap.width,
    height: bitmap.height,
  };

  const canvas = document.createElement("canvas");
  canvas.width = target.width;
  canvas.height = target.height;
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close?.();
    throw new UndecodableImageError("This browser could not convert that photo.");
  }
  context.drawImage(bitmap, 0, 0, target.width, target.height);
  bitmap.close?.();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.9),
  );
  if (!blob) {
    throw new UndecodableImageError("This browser could not convert that photo.");
  }

  return {
    blob,
    contentType: "image/jpeg",
    width: target.width,
    height: target.height,
    untouched: false,
  };
}
