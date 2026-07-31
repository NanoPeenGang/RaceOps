import { createHash } from "node:crypto";
import { crc32, deflateRawSync } from "node:zlib";
import forge from "node-forge";

/**
 * Building a signed Apple Wallet pass.
 *
 * A `.pkpass` is a ZIP containing `pass.json`, some images, a `manifest.json`
 * of SHA-1 hashes, and a detached PKCS#7 signature over that manifest. iOS
 * refuses anything unsigned or signed by a certificate it does not recognise,
 * so this only works with a real Apple Pass Type ID certificate — see
 * `walletConfig()` for what has to be configured, and note that the feature
 * hides itself rather than producing a file the phone will reject.
 *
 * The ZIP writer is hand-rolled because the format for a handful of small
 * files is a few well-specified structures, and every step of it can be
 * checked with `unzip`. The *signing* is not hand-rolled, for the same reason
 * the QR encoder is not: getting PKCS#7 subtly wrong produces a file that
 * looks correct and is rejected on a phone in a car park.
 */

export interface WalletCertificates {
  passTypeIdentifier: string;
  teamIdentifier: string;
  organizationName: string;
  /** PEM. The Pass Type ID certificate from the Apple Developer portal. */
  signerCertPem: string;
  /** PEM. Its private key. */
  signerKeyPem: string;
  /** Passphrase for the key, where it has one. */
  signerKeyPassphrase?: string;
  /** PEM. Apple's Worldwide Developer Relations intermediate certificate. */
  wwdrCertPem: string;
}

/**
 * Wallet configuration, or null when this deployment cannot sign passes.
 *
 * Null rather than throwing, and checked before any Wallet button is rendered:
 * a download that hands somebody a file their phone silently refuses is worse
 * than no button, because they will believe they have a pass.
 *
 * Certificates are read from the environment as PEM. They are secrets — the
 * private key here can mint passes under the organization's Apple identity —
 * so they never reach the client and are never logged.
 */
export function walletConfig(): WalletCertificates | null {
  const passTypeIdentifier = process.env.APPLE_WALLET_PASS_TYPE_ID;
  const teamIdentifier = process.env.APPLE_WALLET_TEAM_ID;
  const signerCertPem = process.env.APPLE_WALLET_SIGNER_CERT;
  const signerKeyPem = process.env.APPLE_WALLET_SIGNER_KEY;
  const wwdrCertPem = process.env.APPLE_WALLET_WWDR_CERT;

  if (
    !passTypeIdentifier ||
    !teamIdentifier ||
    !signerCertPem ||
    !signerKeyPem ||
    !wwdrCertPem
  ) {
    return null;
  }

  return {
    passTypeIdentifier,
    teamIdentifier,
    organizationName: process.env.APPLE_WALLET_ORG_NAME ?? "RaceOps",
    signerCertPem,
    signerKeyPem,
    signerKeyPassphrase: process.env.APPLE_WALLET_SIGNER_KEY_PASSPHRASE,
    wwdrCertPem,
  };
}

// ---------------------------------------------------------------------------
// ZIP
// ---------------------------------------------------------------------------

export interface ZipEntry {
  name: string;
  data: Buffer;
}

/** DOS date/time, which is what a ZIP local header carries. */
function dosTime(date: Date): { time: number; date: number } {
  return {
    time:
      (date.getHours() << 11) |
      (date.getMinutes() << 5) |
      (Math.floor(date.getSeconds() / 2) & 0x1f),
    // Years are counted from 1980 in a ZIP, and clamped so a clock set to
    // 1970 does not produce a negative field.
    date:
      (Math.max(0, date.getFullYear() - 1980) << 9) |
      ((date.getMonth() + 1) << 5) |
      date.getDate(),
  };
}

/**
 * A ZIP archive of small files, deflated.
 *
 * No ZIP64, no encryption, no directory entries — a `.pkpass` is a handful of
 * files well under 4 GB, and supporting more would be code with no caller.
 */
export function zip(entries: readonly ZipEntry[], now = new Date()): Buffer {
  const { time, date } = dosTime(now);
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const compressed = deflateRawSync(entry.data);
    const sum = crc32(entry.data);

    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0); // local file header
    local.writeUInt16LE(20, 4); // version needed: 2.0, deflate
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(8, 8); // method: deflate
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(sum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28); // extra field length
    name.copy(local, 30);
    locals.push(local, compressed);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0); // central directory header
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(sum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk number
    central.writeUInt16LE(0, 36); // internal attributes
    central.writeUInt32LE(0, 38); // external attributes
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    centrals.push(central);

    offset += local.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); // end of central directory
  end.writeUInt16LE(0, 4); // this disk
  end.writeUInt16LE(0, 6); // disk with central directory
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...locals, centralDirectory, end]);
}

// ---------------------------------------------------------------------------
// Manifest and signature
// ---------------------------------------------------------------------------

/**
 * SHA-1 of every file, which is what Apple specifies.
 *
 * SHA-1 is weak, and it is still the right call here: the manifest's integrity
 * comes from the PKCS#7 signature over it, not from the hash function, and a
 * pass built with anything else is simply rejected.
 */
export function buildManifest(entries: readonly ZipEntry[]): Buffer {
  const manifest: Record<string, string> = {};
  for (const entry of entries) {
    manifest[entry.name] = createHash("sha1").update(entry.data).digest("hex");
  }
  return Buffer.from(JSON.stringify(manifest), "utf8");
}

/**
 * Detached PKCS#7 signature over the manifest.
 *
 * Detached because the manifest travels in the archive as its own file; the
 * signature covers it without containing it. The WWDR intermediate is included
 * in the chain so a phone can build a path to Apple's root without fetching
 * anything — which matters when the phone is in a paddock with no signal.
 */
export function signManifest(
  manifest: Buffer,
  certs: WalletCertificates,
): Buffer {
  const signerCert = forge.pki.certificateFromPem(certs.signerCertPem);
  const wwdrCert = forge.pki.certificateFromPem(certs.wwdrCertPem);
  const key = certs.signerKeyPassphrase
    ? forge.pki.decryptRsaPrivateKey(
        certs.signerKeyPem,
        certs.signerKeyPassphrase,
      )
    : forge.pki.privateKeyFromPem(certs.signerKeyPem);

  if (!key) {
    throw new Error(
      "Apple Wallet signing key could not be read. Check APPLE_WALLET_SIGNER_KEY and its passphrase.",
    );
  }

  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(manifest.toString("binary"));
  p7.addCertificate(signerCert);
  p7.addCertificate(wwdrCert);
  p7.addSigner({
    key,
    certificate: signerCert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: new Date().toISOString() },
    ],
  });
  p7.sign({ detached: true });

  return Buffer.from(
    forge.asn1.toDer(p7.toAsn1()).getBytes(),
    "binary",
  );
}

/**
 * A complete, signed `.pkpass`.
 *
 * `images` are the PNGs Wallet requires — at minimum `icon.png` and
 * `logo.png`, without which iOS rejects the pass even when the signature is
 * perfect. They are passed in rather than read here so the caller can brand a
 * pass per series later without this needing to know about branding.
 */
export function buildPkPass(
  passJson: Record<string, unknown>,
  images: readonly ZipEntry[],
  certs: WalletCertificates,
): Buffer {
  const files: ZipEntry[] = [
    { name: "pass.json", data: Buffer.from(JSON.stringify(passJson), "utf8") },
    ...images,
  ];
  const manifest = buildManifest(files);
  const signature = signManifest(manifest, certs);

  return zip([
    ...files,
    { name: "manifest.json", data: manifest },
    { name: "signature", data: signature },
  ]);
}
