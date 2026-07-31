import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/server/db/client";
import { buildPassJson } from "@/lib/wallet";
import { isValidPass } from "@/lib/credentials";
import { buildPkPass, walletConfig, type ZipEntry } from "@/server/services/pkpass";
import { credentialUrl } from "@/server/services/qr";
import { eventVenueLabel } from "@/lib/tracks";

/**
 * Downloads one accreditation pass as an Apple Wallet `.pkpass`.
 *
 * A route handler rather than a tRPC procedure because the response is a
 * binary file with a content type iOS recognises — hitting this URL on an
 * iPhone opens Wallet's "Add" sheet directly, which is the entire point.
 *
 * Only the holder may download their own pass. Not an organizer, not a team
 * manager: a `.pkpass` installs onto a phone and looks identical to the real
 * thing, so the set of people who can obtain one is exactly the set of people
 * it belongs to.
 */

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ credentialId: string }> },
) {
  const { credentialId } = await params;
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) {
    return new Response("Sign in to download your pass.", { status: 401 });
  }

  const config = walletConfig();
  if (!config) {
    return new Response(
      "Apple Wallet is not configured on this deployment. Print the pass instead.",
      { status: 503, headers: { "content-type": "text/plain" } },
    );
  }

  const user = await db.user.findUnique({
    where: { authProviderId: clerkUserId },
    select: { id: true },
  });
  if (!user) return new Response("Sign in to download your pass.", { status: 401 });

  const credential = await db.credential.findUnique({
    where: { id: credentialId },
    select: {
      holderUserId: true,
      holderName: true,
      holderRole: true,
      serial: true,
      qrToken: true,
      status: true,
      credentialType: { select: { name: true, zones: true } },
      registration: {
        select: {
          carNumber: true,
          team: { select: { name: true } },
        },
      },
      event: {
        select: {
          name: true,
          date: true,
          venue: true,
          series: { select: { name: true } },
          trackLayout: {
            select: {
              name: true,
              platform: true,
              track: { select: { name: true } },
            },
          },
        },
      },
    },
  });

  // One 404 for "no such pass" and for "not yours": whether an id is a pass at
  // all is not something to confirm to somebody it does not belong to.
  if (!credential || credential.holderUserId !== user.id) {
    return new Response("No such pass.", { status: 404 });
  }
  if (!credential.qrToken || !isValidPass(credential.status)) {
    /*
     * A cancelled pass must never become a file. Once it is in Wallet it is
     * cached on the device, and somebody waving a greyed-out card at a gate in
     * poor light is worse than their having nothing to wave.
     */
    return new Response("This pass is not valid and cannot be added to Wallet.", {
      status: 409,
      headers: { "content-type": "text/plain" },
    });
  }

  const passJson = buildPassJson(
    {
      token: credential.qrToken,
      holderName: credential.holderName,
      holderRole: credential.holderRole,
      typeName: credential.credentialType.name,
      zones: credential.credentialType.zones,
      teamName: credential.registration?.team?.name ?? null,
      carNumber: credential.registration?.carNumber ?? null,
      serial: credential.serial,
      status: credential.status,
      eventName: credential.event.name,
      seriesName: credential.event.series?.name ?? null,
      eventDate: credential.event.date,
      venue: eventVenueLabel(credential.event),
      url: credentialUrl(credential.qrToken),
    },
    config,
  );

  const images = await walletImages();
  const pkpass = buildPkPass(passJson, images, config);

  return new Response(new Uint8Array(pkpass), {
    headers: {
      "content-type": "application/vnd.apple.pkpass",
      "content-disposition": `attachment; filename="raceops-pass.pkpass"`,
      // A pass carries a token; it must not sit in a shared cache.
      "cache-control": "private, no-store",
    },
  });
}

/**
 * The PNGs Wallet requires.
 *
 * iOS rejects a pass with no `icon.png` even when the signature is perfect,
 * and the failure message says only that the pass cannot be installed. The
 * brand assets already in `public/` are reused rather than adding more files
 * to keep in sync.
 */
async function walletImages(): Promise<ZipEntry[]> {
  const brand = join(process.cwd(), "public", "brand");
  const [mark, wordmark] = await Promise.all([
    readFile(join(brand, "raceops-mark.png")),
    readFile(join(brand, "raceops-logo.png")),
  ]);
  return [
    { name: "icon.png", data: mark },
    { name: "icon@2x.png", data: mark },
    { name: "logo.png", data: wordmark },
    { name: "logo@2x.png", data: wordmark },
  ];
}
