/**
 * Direct media upload: what may be uploaded, where it lands, and how big.
 *
 * Everything here is pure so the rules hold identically on the client (which
 * decides what to offer and how far to downscale) and on the server (which
 * decides what to sign). A rule enforced only on the client is not a rule.
 */

/**
 * What an upload is for. The purpose decides the size cap and the target
 * dimensions, because a paddock photo and an avatar have nothing in common:
 * downscaling a banner to 512px would ruin it, and keeping an avatar at 4000px
 * wastes a phone's data allowance for no visible gain.
 */
export type UploadPurpose =
  | "avatar"
  | "logo"
  | "banner"
  | "diagram"
  | "media"
  | "document"
  | "garage";

export interface PurposeRules {
  label: string;
  /** Hard cap on the uploaded bytes, after any client-side downscale. */
  maxBytes: number;
  /** Longest edge to downscale to before upload. Null leaves it alone. */
  maxEdge: number | null;
  accept: readonly string[];
}

/** Images only, except documents. Kept explicit — no `image/*` wildcard, so a
 *  browser cannot offer an SVG (which can carry script) as an image. */
const IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
  "image/gif",
] as const;

export const UPLOAD_RULES: Record<UploadPurpose, PurposeRules> = {
  avatar: {
    label: "Profile picture",
    maxBytes: 5 * 1024 * 1024,
    maxEdge: 512,
    accept: IMAGE_TYPES,
  },
  logo: {
    label: "Logo",
    maxBytes: 5 * 1024 * 1024,
    maxEdge: 1024,
    accept: IMAGE_TYPES,
  },
  banner: {
    label: "Banner",
    // Wide images carry real detail; downscaling to 2560 keeps a retina
    // display sharp without shipping a 12-megapixel phone photo.
    maxBytes: 15 * 1024 * 1024,
    maxEdge: 2560,
    accept: IMAGE_TYPES,
  },
  diagram: {
    label: "Track map",
    // A circuit diagram is read for detail — corner numbers, pit entry, an
    // access road — so it keeps more resolution than a logo and less than a
    // banner, which is decoration and can afford to be huge.
    maxBytes: 10 * 1024 * 1024,
    maxEdge: 2048,
    accept: IMAGE_TYPES,
  },
  media: {
    label: "Photo or video",
    maxBytes: 100 * 1024 * 1024,
    // Race photography is the point; re-encoding it in a canvas would be
    // vandalism. Videos cannot be downscaled client-side at all.
    maxEdge: null,
    accept: [...IMAGE_TYPES, "video/mp4", "video/quicktime", "video/webm"],
  },
  document: {
    label: "Document",
    maxBytes: 25 * 1024 * 1024,
    maxEdge: null,
    accept: ["application/pdf"],
  },
  garage: {
    label: "Telemetry or setup file",
    // A session of high-rate logging is genuinely tens of megabytes.
    maxBytes: 100 * 1024 * 1024,
    maxEdge: null,
    /*
     * Every logger and every sim has its own format and browsers report most
     * of them as octet-stream, so this list is about what is *not* allowed
     * rather than an inventory of data formats. HTML and SVG are the reason
     * it is a list at all: both execute script when opened from the bucket's
     * origin, and neither is telemetry.
     */
    accept: [
      "application/octet-stream",
      "application/zip",
      "application/x-zip-compressed",
      "application/json",
      "application/pdf",
      "text/csv",
      "text/plain",
      "image/jpeg",
      "image/png",
      "image/webp",
    ],
  },
};

export function isAllowedType(
  purpose: UploadPurpose,
  contentType: string,
): boolean {
  return UPLOAD_RULES[purpose].accept.includes(contentType);
}

/** Human size for an error a person has to act on. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export interface UploadRejection {
  reason: "type" | "size";
  message: string;
}

/**
 * Whether a file may be uploaded at all.
 *
 * Returns a message a person can act on rather than a boolean: "that file is
 * 18.4 MB and the limit is 15 MB" tells someone what to do next, and "invalid
 * file" does not.
 */
export function checkUpload(
  purpose: UploadPurpose,
  file: { type: string; size: number },
): UploadRejection | null {
  const rules = UPLOAD_RULES[purpose];
  if (!isAllowedType(purpose, file.type)) {
    return {
      reason: "type",
      message: `${rules.label} must be ${describeTypes(rules.accept)}.`,
    };
  }
  if (file.size > rules.maxBytes) {
    return {
      reason: "size",
      message: `That file is ${formatBytes(file.size)}; the limit is ${formatBytes(rules.maxBytes)}.`,
    };
  }
  return null;
}

/** "a JPEG, PNG, WebP, AVIF or GIF" — the list as a person would say it. */
export function describeTypes(types: readonly string[]): string {
  const names = types.map(
    (type) =>
      ({
        "image/jpeg": "JPEG",
        "image/png": "PNG",
        "image/webp": "WebP",
        "image/avif": "AVIF",
        "image/gif": "GIF",
        "video/mp4": "MP4",
        "video/quicktime": "MOV",
        "video/webm": "WebM",
        "application/pdf": "PDF",
      })[type] ?? type,
  );
  if (names.length === 1) return `a ${names[0]}`;
  return `a ${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
}

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "application/pdf": "pdf",
};

export function extensionFor(contentType: string): string {
  return EXTENSIONS[contentType] ?? "bin";
}

/**
 * The object key an upload lands at.
 *
 * Generated on the server and never taken from the client. A client-chosen key
 * means one account can overwrite another's objects, and a client-supplied
 * filename means path traversal — so the original name is kept only as a short
 * readable slug, and identity comes from a random token.
 */
export function buildObjectKey(input: {
  purpose: UploadPurpose;
  ownerId: string;
  contentType: string;
  originalName?: string | null;
  token: string;
}): string {
  const slug = safeName(input.originalName);
  const extension = extensionFor(input.contentType);
  const name = slug ? `${slug}-${input.token}` : input.token;
  return `${input.purpose}/${input.ownerId}/${name}.${extension}`;
}

/**
 * A filename reduced to something safe to put in a key.
 *
 * Anything that is not a plain letter, digit or dash goes — which removes
 * slashes, dots and every traversal trick at once rather than blocklisting
 * them one at a time.
 */
export function safeName(name: string | null | undefined): string {
  if (!name) return "";
  // Basename first, then extension, then sanitize. Doing it in this order
  // matters: stripping the extension from "../../etc/passwd" first would eat
  // most of the string, and while the result is still safe, it throws away a
  // perfectly usable name for no reason.
  const basename = name.split(/[\\/]/).pop() ?? "";
  const withoutExtension = basename.replace(/\.[^.]+$/, "");
  return withoutExtension
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/**
 * Target dimensions after downscaling, preserving aspect ratio.
 *
 * Returns null when the image is already within bounds, so a correctly sized
 * logo is uploaded untouched rather than re-encoded — re-encoding a PNG
 * through a canvas loses its transparency-friendly palette for nothing.
 */
export function scaleToFit(
  width: number,
  height: number,
  maxEdge: number | null,
): { width: number; height: number } | null {
  if (!maxEdge) return null;
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return null;
  const ratio = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
}

/**
 * Whether a stored URL belongs to the configured public bucket.
 *
 * Registering an upload takes a URL, and without this check that mutation is a
 * way to point a logo — rendered on a public page — at any host on the
 * internet. Attach-by-URL remains available separately and deliberately; this
 * guards the path that claims "I just uploaded this".
 */
export function isOwnStorageUrl(
  url: string,
  publicBaseUrl: string | null | undefined,
): boolean {
  if (!publicBaseUrl) return false;
  try {
    const parsed = new URL(url);
    const base = new URL(publicBaseUrl);
    if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") {
      return false;
    }
    return (
      parsed.origin === base.origin &&
      parsed.pathname.startsWith(base.pathname.replace(/\/+$/, ""))
    );
  } catch {
    return false;
  }
}
