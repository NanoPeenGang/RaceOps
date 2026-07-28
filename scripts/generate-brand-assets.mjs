/**
 * Derives all brand assets from the canonical logo at
 * assets/brand/raceops-logo-source.png:
 *
 *   public/brand/raceops-logo.png   transparent, trimmed full lockup
 *   public/brand/raceops-mark.png   square crop of the checkered-flag "R" mark
 *   public/favicon.ico              32px + 16px, from the mark
 *   public/apple-touch-icon.png     180px, from the mark
 *
 * The source export has its transparency flattened onto a light-gray
 * checkerboard, so this script keys neutral light pixels back to transparent.
 * The logo artwork itself is not recolored.
 */
import sharp from "sharp";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = join(root, "assets", "brand", "raceops-logo-source.png");
const brandDir = join(root, "public", "brand");
const publicDir = join(root, "public");
mkdirSync(brandDir, { recursive: true });

// --- 1. Key the flattened checkerboard background to transparency ----------

const { data, info } = await sharp(sourcePath)
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });

for (let i = 0; i < data.length; i += 4) {
  const r = data[i];
  const g = data[i + 1];
  const b = data[i + 2];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);

  if (min > 215 && max - min < 40) {
    // Checkerboard squares (white / light gray, incl. compression noise).
    data[i + 3] = 0;
    continue;
  }

  if (r - b > 50 && r - g > 50) {
    // Red ink, or a red↔white anti-aliased blend (reads as pink when
    // flattened). Unmix against white assuming brand red (~min channel 29):
    // observed = red*a + white*(1-a)  =>  a = (255 - min) / (255 - 29).
    const a = Math.min(1, (255 - min) / 226);
    if (a < 0.999) {
      data[i] = clamp255((r - 255 * (1 - a)) / a);
      data[i + 1] = clamp255((g - 255 * (1 - a)) / a);
      data[i + 2] = clamp255((b - 255 * (1 - a)) / a);
      data[i + 3] = Math.round(a * 255);
    }
    continue;
  }

  if (max - min < 40 && min > 90) {
    // Black↔white anti-aliased edge: darker = more opaque, snapped toward
    // brand black so edges don't halo on dark surfaces.
    data[i + 3] = Math.round(255 * Math.min(1, (215 - min) / 125));
    data[i] = data[i + 1] = data[i + 2] = 10;
  }
  // Everything else (solid black artwork, other colors): fully opaque.
}

function clamp255(n) {
  return Math.max(0, Math.min(255, Math.round(n)));
}

const keyed = sharp(data, {
  raw: { width: info.width, height: info.height, channels: 4 },
});

// Trim the large empty margins around the lockup.
const lockup = await keyed.png().toBuffer();
const trimmed = await sharp(lockup).trim().png().toBuffer();
writeFileSync(join(brandDir, "raceops-logo.png"), trimmed);

// --- 2. Square "R" mark: everything left of the wordmark -------------------

const trimmedMeta = await sharp(trimmed).metadata();
const { data: tData, info: tInfo } = await sharp(trimmed)
  .raw()
  .toBuffer({ resolveWithObject: true });

// Find the widest fully-transparent column gap — it separates the mark from
// the "RaceOps" wordmark.
const colHasInk = new Array(tInfo.width).fill(false);
for (let x = 0; x < tInfo.width; x++) {
  for (let y = 0; y < tInfo.height; y++) {
    if (tData[(y * tInfo.width + x) * 4 + 3] > 8) {
      colHasInk[x] = true;
      break;
    }
  }
}
let bestGapStart = 0;
let bestGapLen = 0;
let gapStart = -1;
for (let x = 0; x <= tInfo.width; x++) {
  const empty = x < tInfo.width && !colHasInk[x];
  if (empty && gapStart === -1) gapStart = x;
  if (!empty && gapStart !== -1) {
    const len = x - gapStart;
    // Ignore gaps at the far edges; we want an interior separator.
    if (len > bestGapLen && gapStart > 0 && x < tInfo.width) {
      bestGapLen = len;
      bestGapStart = gapStart;
    }
    gapStart = -1;
  }
}
if (bestGapLen === 0) {
  throw new Error("Could not locate the mark/wordmark gap in the logo.");
}

const markWidth = bestGapStart;
const markBuffer = await sharp(trimmed)
  .extract({ left: 0, top: 0, width: markWidth, height: trimmedMeta.height })
  .trim()
  .png()
  .toBuffer();

// Pad to a square canvas (safe area) for icon usage.
const markMeta = await sharp(markBuffer).metadata();
const side = Math.round(Math.max(markMeta.width, markMeta.height) * 1.1);
const squareMark = await sharp(markBuffer)
  .resize(side, side, {
    fit: "contain",
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  })
  .png()
  .toBuffer();
writeFileSync(
  join(brandDir, "raceops-mark.png"),
  await sharp(squareMark).resize(512, 512).png().toBuffer(),
);

// --- 3. Favicon + apple-touch-icon from the mark ---------------------------

/** Minimal ICO container embedding PNG images (supported by all modern browsers). */
function buildIco(pngBuffers) {
  const count = pngBuffers.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);

  const entries = [];
  let offset = 6 + 16 * count;
  for (const { size, buffer } of pngBuffers) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size === 256 ? 0 : size, 0);
    entry.writeUInt8(size === 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(buffer.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += buffer.length;
    entries.push(entry);
  }
  return Buffer.concat([header, ...entries, ...pngBuffers.map((p) => p.buffer)]);
}

const icon32 = await sharp(squareMark).resize(32, 32).png().toBuffer();
const icon16 = await sharp(squareMark).resize(16, 16).png().toBuffer();
writeFileSync(
  join(publicDir, "favicon.ico"),
  buildIco([
    { size: 32, buffer: icon32 },
    { size: 16, buffer: icon16 },
  ]),
);

writeFileSync(
  join(publicDir, "apple-touch-icon.png"),
  await sharp(squareMark).resize(180, 180).png().toBuffer(),
);

console.log(
  `Brand assets derived from canonical logo (lockup ${trimmedMeta.width}x${trimmedMeta.height}, mark split at x=${markWidth}).`,
);
