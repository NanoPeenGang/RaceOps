import { createHash, createHmac, randomBytes } from "node:crypto";

/**
 * Presigned uploads to S3-compatible object storage (Cloudflare R2, S3, MinIO).
 *
 * SigV4 is implemented here rather than pulling in the AWS SDK: presigning a
 * single PUT is about sixty lines of a well-specified algorithm, and the SDK
 * is a large dependency to carry into a serverless bundle for one call.
 *
 * The browser uploads straight to storage, so a 40 MB paddock photo never
 * passes through the app server — which is the difference between an upload
 * that works on circuit wifi and one that times out in a function.
 */

export interface StorageConfig {
  accountEndpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  /** Where objects are served from once written. */
  publicBaseUrl: string;
}

/**
 * Storage config, or null when it is not set up.
 *
 * Null rather than throwing: the platform has always worked with attach-by-URL
 * and must keep working on a deployment with no bucket. The UI asks this and
 * hides the file picker rather than offering a button that always fails.
 */
export function storageConfig(): StorageConfig | null {
  const accountEndpoint = process.env.S3_ENDPOINT;
  const bucket = process.env.S3_BUCKET;
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
  const publicBaseUrl = process.env.S3_PUBLIC_BASE_URL;

  if (
    !accountEndpoint ||
    !bucket ||
    !accessKeyId ||
    !secretAccessKey ||
    !publicBaseUrl
  ) {
    return null;
  }
  return {
    accountEndpoint: accountEndpoint.replace(/\/+$/, ""),
    bucket,
    accessKeyId,
    secretAccessKey,
    // R2 ignores the region but the signature still has to carry one.
    region: process.env.S3_REGION ?? "auto",
    publicBaseUrl: publicBaseUrl.replace(/\/+$/, ""),
  };
}

export function publicUrlFor(config: StorageConfig, key: string): string {
  return `${config.publicBaseUrl}/${key}`;
}

/** A random, unguessable token for an object key. */
export function uploadToken(): string {
  return randomBytes(12).toString("hex");
}

const sha256 = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");

const hmac = (key: Buffer | string, value: string) =>
  createHmac("sha256", key).update(value, "utf8").digest();

/**
 * Percent-encodes for SigV4, which is stricter than `encodeURIComponent`:
 * it requires uppercase hex and does not exempt `!'()*`. Getting this wrong
 * produces signatures that fail only for filenames containing those
 * characters, which is the kind of bug that ships.
 */
function uriEncode(value: string, encodeSlash: boolean): string {
  let out = "";
  for (const char of value) {
    if (/[A-Za-z0-9\-._~]/.test(char)) {
      out += char;
    } else if (char === "/") {
      out += encodeSlash ? "%2F" : "/";
    } else {
      out += [...Buffer.from(char, "utf8")]
        .map((byte) => `%${byte.toString(16).toUpperCase().padStart(2, "0")}`)
        .join("");
    }
  }
  return out;
}

export interface PresignedUpload {
  /** PUT the bytes here, with the exact `Content-Type` that was signed. */
  uploadUrl: string;
  /** Where the object will be readable once the PUT succeeds. */
  publicUrl: string;
  key: string;
  expiresInSeconds: number;
}

/**
 * Presigns a single PUT.
 *
 * `Content-Type` is a signed header, not a hint: an upload that arrives as a
 * different type than was authorised fails the signature. That is what stops a
 * presign issued for a JPEG being used to store an HTML file, which would then
 * be served from the same origin as the app.
 */
export function presignUpload(
  config: StorageConfig,
  input: {
    key: string;
    contentType: string;
    expiresInSeconds?: number;
  },
): PresignedUpload {
  const expiresInSeconds = input.expiresInSeconds ?? 300;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);

  const endpoint = new URL(config.accountEndpoint);
  const canonicalUri = `/${uriEncode(config.bucket, true)}/${uriEncode(input.key, false)}`;
  const scope = `${dateStamp}/${config.region}/s3/aws4_request`;

  // Content-Type is signed, so it must be in SignedHeaders alongside host.
  const signedHeaders = "content-type;host";
  const canonicalHeaders = `content-type:${input.contentType}\nhost:${endpoint.host}\n`;

  const query = new Map<string, string>([
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", `${config.accessKeyId}/${scope}`],
    ["X-Amz-Date", amzDate],
    ["X-Amz-Expires", String(expiresInSeconds)],
    ["X-Amz-SignedHeaders", signedHeaders],
  ]);
  const canonicalQuery = [...query.entries()]
    .map(([k, v]) => [uriEncode(k, true), uriEncode(v, true)] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");

  const canonicalRequest = [
    "PUT",
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    // Presigned requests do not hash the body.
    "UNSIGNED-PAYLOAD",
  ].join("\n");

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    sha256(canonicalRequest),
  ].join("\n");

  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${config.secretAccessKey}`, dateStamp), config.region), "s3"),
    "aws4_request",
  );
  const signature = createHmac("sha256", signingKey)
    .update(stringToSign, "utf8")
    .digest("hex");

  return {
    uploadUrl: `${endpoint.origin}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`,
    publicUrl: publicUrlFor(config, input.key),
    key: input.key,
    expiresInSeconds,
  };
}
