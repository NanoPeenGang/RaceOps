/**
 * Generates the RaceOps brand assets into public/brand and public/.
 *
 * NOTE: the canonical logo PNG described in the spec (assets/brand/raceops-logo.png)
 * was not present in the repository, so this script renders a placeholder that
 * follows the brand description: black "R" mark with a red-and-black
 * checkered-flag accent + "RaceOps" wordmark (black "Race", red "Ops").
 * When the real asset is supplied, drop it into public/brand/ and re-run this
 * script only for favicon/mark derivation.
 */
import sharp from "sharp";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const brandDir = join(root, "public", "brand");
const publicDir = join(root, "public");
mkdirSync(brandDir, { recursive: true });

const BLACK = "#0A0A0A";
const RED = "#D91E1E";

/** Checkered-flag accent: 2x4 grid of alternating red/black squares. */
function checker(x, y, size) {
  let squares = "";
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 4; col++) {
      const fill = (row + col) % 2 === 0 ? RED : BLACK;
      squares += `<rect x="${x + col * size}" y="${y + row * size}" width="${size}" height="${size}" fill="${fill}"/>`;
    }
  }
  return squares;
}

/** Square "R" mark with checkered accent underneath. */
const markSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <rect width="256" height="256" fill="none"/>
  <text x="118" y="172" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="176" fill="${BLACK}">R</text>
  <g>${checker(48, 196, 20)}</g>
</svg>`;

/** Full lockup: mark + "RaceOps" wordmark. */
const lockupSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="160" viewBox="0 0 600 160">
  <rect width="600" height="160" fill="none"/>
  <text x="58" y="112" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="104" fill="${BLACK}">R</text>
  <g>${checker(18, 124, 12)}</g>
  <text x="128" y="106" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="72" fill="${BLACK}">Race<tspan fill="${RED}">Ops</tspan></text>
</svg>`;

async function pngFromSvg(svg, width, height) {
  return sharp(Buffer.from(svg)).resize(width, height).png().toBuffer();
}

/** Minimal ICO container embedding PNG images (supported by all modern browsers). */
function buildIco(pngBuffers) {
  const count = pngBuffers.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(count, 4);

  const entries = [];
  let offset = 6 + 16 * count;
  for (const { size, buffer } of pngBuffers) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size === 256 ? 0 : size, 0); // width
    entry.writeUInt8(size === 256 ? 0 : size, 1); // height
    entry.writeUInt8(0, 2); // palette
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // color planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(buffer.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += buffer.length;
    entries.push(entry);
  }
  return Buffer.concat([header, ...entries, ...pngBuffers.map((p) => p.buffer)]);
}

const lockupPng = await pngFromSvg(lockupSvg, 600, 160);
writeFileSync(join(brandDir, "raceops-logo.png"), lockupPng);

const markPng = await pngFromSvg(markSvg, 256, 256);
writeFileSync(join(brandDir, "raceops-mark.png"), markPng);

const icon32 = await pngFromSvg(markSvg, 32, 32);
const icon16 = await pngFromSvg(markSvg, 16, 16);
writeFileSync(
  join(publicDir, "favicon.ico"),
  buildIco([
    { size: 32, buffer: icon32 },
    { size: 16, buffer: icon16 },
  ]),
);

const appleTouch = await pngFromSvg(markSvg, 180, 180);
writeFileSync(join(publicDir, "apple-touch-icon.png"), appleTouch);

console.log("Brand assets written to public/brand and public/.");
