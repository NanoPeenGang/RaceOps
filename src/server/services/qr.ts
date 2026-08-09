import QRCode from "qrcode";

/**
 * QR codes for accreditation passes and part labels.
 *
 * Rendered on the server as inline SVG rather than as a PNG data URI: a pass
 * sheet is printed, and vector stays sharp at whatever size a laser printer
 * and a badge holder conspire to produce. Inline also means no second request
 * per badge, which matters on a sheet with two hundred of them.
 *
 * The encoding itself comes from a library on purpose. Reed–Solomon error
 * correction and mask selection are well-specified but unforgiving, and a
 * subtly wrong implementation produces codes that look right and do not scan —
 * a failure that would only surface on a gate at 07:00 on a Saturday.
 */

/**
 * Error correction level.
 *
 * `M` (~15% recovery) rather than the default `L`. A badge lives on a lanyard
 * in a wet paddock and gets creased, and the extra redundancy costs a slightly
 * denser code that a phone camera still reads without effort.
 */
const ERROR_CORRECTION = "M" as const;

/**
 * An SVG QR code for a URL.
 *
 * Returns the `<svg>` element as a string, with no XML declaration, so it can
 * be dropped straight into a page. `margin: 2` is the smallest quiet zone the
 * spec allows; going below it is the most common reason a printed code fails
 * to scan.
 */
export async function qrSvg(
  value: string,
  options: { size?: number } = {},
): Promise<string> {
  return QRCode.toString(value, {
    type: "svg",
    errorCorrectionLevel: ERROR_CORRECTION,
    margin: 2,
    width: options.size ?? 160,
  });
}

/**
 * The URL a pass's QR code resolves to.
 *
 * Absolute, because a QR code is scanned by a phone that has no idea what
 * origin the badge was printed from. Falls back to a relative path when the
 * app URL is not configured — which still works if the marshal is already on
 * the site, and is visibly wrong in a way that gets noticed before race day
 * rather than silently pointing at localhost.
 */
export function credentialUrl(token: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "");
  return base ? `${base}/pass/${token}` : `/pass/${token}`;
}

/**
 * The URL a part label's QR code resolves to.
 *
 * Absolute for the same reason a pass URL is: the phone reading it has no idea
 * what origin the label was printed from, and a label outlives the laptop it
 * was printed on.
 *
 * The kind is in the path rather than in a query string so a bin label and a
 * part label are distinguishable from the scanned text alone, without a
 * database round trip to find out which table to look in. `i` for the stock
 * line, `u` for one physical unit.
 */
export function partLabelUrl(kind: "line" | "unit", token: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "");
  const path = `/parts/${kind === "unit" ? "u" : "i"}/${token}`;
  return base ? `${base}${path}` : path;
}
