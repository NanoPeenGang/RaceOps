import { describe, expect, it } from "vitest";
import sharp from "sharp";
import jsQR from "jsqr";
import { credentialUrl, qrSvg } from "@/server/services/qr";

/**
 * The one assertion that matters about a badge: it scans.
 *
 * Everything else in accreditation can be checked by reading the code. A QR
 * cannot — a subtly wrong encoder produces a square that looks entirely
 * correct and reads as nothing, and the first person to find out is a marshal
 * on a gate at 07:00 on a Saturday. So this rasterises the SVG the way a
 * printer would and decodes it the way a phone camera would.
 */

async function decode(svg: string, size = 400): Promise<string | null> {
  const { data, info } = await sharp(Buffer.from(svg))
    // Nearest-neighbour: a QR is a grid of hard squares, and smoothing them is
    // the one thing that would make this test pass where a printer fails.
    .resize(size, size, { kernel: "nearest" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return jsQR(new Uint8ClampedArray(data), info.width, info.height)?.data ?? null;
}

describe("credential QR codes", () => {
  it("round-trips a pass URL through render and scan", async () => {
    const url = "https://raceops.test/pass/xQ7_mA3pLn2ZbK9dR4tS8vWy";
    expect(await decode(await qrSvg(url))).toBe(url);
  });

  it("survives a token with the awkward base64url characters in it", async () => {
    // `-` and `_` are in the alphabet `randomBytes().toString("base64url")`
    // draws from, and are exactly the characters a naive encoder mangles.
    const url = "https://raceops.test/pass/a-b_c-d_efghijklmnopqrst";
    expect(await decode(await qrSvg(url))).toBe(url);
  });

  it("still scans at the size a badge is actually printed", async () => {
    // 92px on the sheet, roughly 24 mm on paper. Below this a phone struggles,
    // which is why the badge layout does not shrink it further.
    const url = credentialUrl("xQ7mA3pLn2ZbK9dR4tS8vWy1");
    expect(await decode(await qrSvg(url, { size: 92 }), 184)).toBe(url);
  });

  it("recovers from a corner of the code being obscured", async () => {
    /*
     * Error correction level M, chosen because a badge lives on a lanyard in a
     * wet paddock. This blanks a patch roughly the size of a thumb over the
     * code and expects it to read anyway.
     */
    const url = "https://raceops.test/pass/xQ7_mA3pLn2ZbK9dR4tS8vWy";
    const rendered = await sharp(Buffer.from(await qrSvg(url)))
      .resize(400, 400, { kernel: "nearest" })
      .ensureAlpha()
      .composite([
        {
          input: {
            create: {
              width: 44,
              height: 44,
              channels: 4,
              background: { r: 255, g: 255, b: 255, alpha: 1 },
            },
          },
          // Off-centre: away from the three finder patterns, which are the
          // one part no amount of error correction can replace.
          top: 200,
          left: 200,
        },
      ])
      .png()
      .toBuffer();

    const { data, info } = await sharp(rendered)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(
      jsQR(new Uint8ClampedArray(data), info.width, info.height)?.data,
    ).toBe(url);
  });
});
