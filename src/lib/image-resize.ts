"use client";

import { scaleToFit, type UploadPurpose, UPLOAD_RULES } from "@/lib/upload";

/**
 * Downscaling a picked image before it is uploaded.
 *
 * A phone camera produces a 12-megapixel, 6 MB JPEG. A logo needs 512 pixels.
 * Uploading the original over circuit wifi is the difference between a feature
 * people use trackside and one they give up on, so the resize happens in the
 * browser before a single byte is sent.
 *
 * Browser-only: it needs canvas. The server enforces the same size caps
 * independently, because a rule enforced only on the client is not a rule.
 */

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
