import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateRawSync, crc32 } from "node:zlib";
import { describe, expect, it } from "vitest";
import forge from "node-forge";
import { AccessZone, CredentialStatus } from "@prisma/client";
import { buildPassJson } from "@/lib/wallet";
import {
  buildManifest,
  buildPkPass,
  signManifest,
  zip,
  type WalletCertificates,
} from "@/server/services/pkpass";

/**
 * A `.pkpass` either works on a phone or is silently refused, so the archive
 * and the signature are checked against tooling that did not write them.
 */

function has(binary: string): boolean {
  try {
    execSync(`command -v ${binary}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Reads back a ZIP through its central directory, as an unzipper would. */
function readZip(archive: Buffer): Map<string, Buffer> {
  const end = archive.lastIndexOf(
    Buffer.from([0x50, 0x4b, 0x05, 0x06]),
  );
  expect(end, "end of central directory record").toBeGreaterThan(-1);
  const count = archive.readUInt16LE(end + 10);
  let cursor = archive.readUInt32LE(end + 16);

  const files = new Map<string, Buffer>();
  for (let i = 0; i < count; i += 1) {
    expect(archive.readUInt32LE(cursor)).toBe(0x02014b50);
    const declaredCrc = archive.readUInt32LE(cursor + 16);
    const compressedSize = archive.readUInt32LE(cursor + 20);
    const uncompressedSize = archive.readUInt32LE(cursor + 24);
    const nameLength = archive.readUInt16LE(cursor + 28);
    const localOffset = archive.readUInt32LE(cursor + 42);
    const name = archive
      .subarray(cursor + 46, cursor + 46 + nameLength)
      .toString("utf8");

    // Follow the offset the central directory claims, which is the field most
    // likely to be wrong and the one that makes an archive unreadable.
    expect(archive.readUInt32LE(localOffset), `${name} local header`).toBe(
      0x04034b50,
    );
    const localNameLength = archive.readUInt16LE(localOffset + 26);
    const extraLength = archive.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + extraLength;
    const data = inflateRawSync(
      archive.subarray(dataStart, dataStart + compressedSize),
    );

    expect(data.length, `${name} size`).toBe(uncompressedSize);
    expect(crc32(data), `${name} checksum`).toBe(declaredCrc);
    files.set(name, data);
    cursor += 46 + nameLength;
  }
  return files;
}

/** A throwaway CA and leaf, so signing is exercised without Apple's. */
function testCertificates(): WalletCertificates {
  const makeCert = (
    commonName: string,
    issuer?: { cert: forge.pki.Certificate; key: forge.pki.rsa.PrivateKey },
  ) => {
    const keys = forge.pki.rsa.generateKeyPair(2048);
    const cert = forge.pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = "01";
    cert.validity.notBefore = new Date();
    cert.validity.notAfter = new Date(Date.now() + 864e5);
    const attrs = [{ name: "commonName", value: commonName }];
    cert.setSubject(attrs);
    cert.setIssuer(issuer ? issuer.cert.subject.attributes : attrs);
    // Without basicConstraints CA:TRUE, openssl refuses to build a chain
    // through the root — the same rule Apple's WWDR intermediate satisfies.
    cert.setExtensions(
      issuer
        ? [{ name: "basicConstraints", cA: false }, { name: "keyUsage", digitalSignature: true }]
        : [{ name: "basicConstraints", cA: true }, { name: "keyUsage", keyCertSign: true }],
    );
    cert.sign(issuer ? issuer.key : keys.privateKey, forge.md.sha256.create());
    return { cert, key: keys.privateKey };
  };

  const ca = makeCert("Test WWDR");
  const signer = makeCert("Test Pass Type", ca);
  return {
    passTypeIdentifier: "pass.test.raceops",
    teamIdentifier: "TEAMID1234",
    organizationName: "RaceOps",
    signerCertPem: forge.pki.certificateToPem(signer.cert),
    signerKeyPem: forge.pki.privateKeyToPem(signer.key),
    wwdrCertPem: forge.pki.certificateToPem(ca.cert),
  };
}

describe("zip", () => {
  it("writes an archive that reads back byte for byte", () => {
    const entries = [
      { name: "pass.json", data: Buffer.from(JSON.stringify({ a: 1 })) },
      // Highly compressible and incompressible, so both deflate paths run.
      { name: "logo.png", data: Buffer.from("x".repeat(5000)) },
      { name: "icon.png", data: Buffer.from(Array.from({ length: 512 }, (_, i) => i % 251)) },
    ];
    const files = readZip(zip(entries));
    expect([...files.keys()].sort()).toEqual([
      "icon.png",
      "logo.png",
      "pass.json",
    ]);
    for (const entry of entries) {
      expect(files.get(entry.name)!.equals(entry.data), entry.name).toBe(true);
    }
  });

  it("survives an empty file and a long name", () => {
    const files = readZip(
      zip([
        { name: "empty.txt", data: Buffer.alloc(0) },
        { name: "a".repeat(120) + ".png", data: Buffer.from("hi") },
      ]),
    );
    expect(files.get("empty.txt")!.length).toBe(0);
    expect(files.get("a".repeat(120) + ".png")!.toString()).toBe("hi");
  });

  it("clamps a pre-1980 clock rather than writing a negative year", () => {
    // ZIP counts years from 1980. A container with a bad clock would otherwise
    // produce a header field that overflows into the month.
    expect(() => readZip(zip([{ name: "a", data: Buffer.from("b") }], new Date(1970, 0, 1)))).not.toThrow();
  });
});

describe("manifest", () => {
  it("hashes every file with SHA-1, which is what Apple specifies", () => {
    const manifest = JSON.parse(
      buildManifest([
        { name: "pass.json", data: Buffer.from("{}") },
        { name: "icon.png", data: Buffer.alloc(4) },
      ]).toString(),
    );
    expect(Object.keys(manifest).sort()).toEqual(["icon.png", "pass.json"]);
    // SHA-1 of "{}"; a different digest here is a pass iOS rejects.
    expect(manifest["pass.json"]).toBe(
      "bf21a9e8fbc5a3846fb05b4fa0859e0917b2202f",
    );
  });
});

describe("pkpass", () => {
  const certs = testCertificates();

  it("packages pass.json, the images, a manifest and a signature", () => {
    const files = readZip(
      buildPkPass({ formatVersion: 1, serialNumber: "abc" },
        [{ name: "icon.png", data: Buffer.alloc(64, 1) }], certs),
    );
    expect([...files.keys()].sort()).toEqual([
      "icon.png",
      "manifest.json",
      "pass.json",
      "signature",
    ]);
    expect(JSON.parse(files.get("pass.json")!.toString()).serialNumber).toBe(
      "abc",
    );
  });

  it("hashes what it actually shipped", () => {
    // A manifest that disagrees with the archive by one byte is a pass the
    // phone refuses, and the only symptom is "cannot be installed".
    const files = readZip(
      buildPkPass({ formatVersion: 1 },
        [{ name: "icon.png", data: Buffer.alloc(64, 3) }], certs),
    );
    const manifest = JSON.parse(files.get("manifest.json")!.toString());
    const sha1 = (data: Buffer) =>
      forge.md.sha1.create().update(data.toString("binary")).digest().toHex();
    expect(manifest["pass.json"]).toBe(sha1(files.get("pass.json")!));
    expect(manifest["icon.png"]).toBe(sha1(files.get("icon.png")!));
    // The signature is over the manifest and so is never in it.
    expect(manifest.signature).toBeUndefined();
    expect(manifest["manifest.json"]).toBeUndefined();
  });

  it("produces a detached signature, not one wrapping the content", () => {
    const signature = signManifest(Buffer.from('{"a":"b"}'), certs);
    expect(signature.length).toBeGreaterThan(500);
    // DER SEQUENCE.
    expect(signature[0]).toBe(0x30);
  });

  it.skipIf(!has("openssl"))(
    "signs something openssl will verify against the chain",
    () => {
      const dir = mkdtempSync(join(tmpdir(), "pkpass-"));
      const manifest = buildManifest([
        { name: "pass.json", data: Buffer.from("{}") },
      ]);
      writeFileSync(join(dir, "manifest.json"), manifest);
      writeFileSync(join(dir, "signature"), signManifest(manifest, certs));
      writeFileSync(join(dir, "ca.pem"), certs.wwdrCertPem);

      const output = execSync(
        `openssl smime -verify -inform DER -in ${join(dir, "signature")} -content ${join(dir, "manifest.json")} -CAfile ${join(dir, "ca.pem")} 2>&1 || true`,
      ).toString();
      expect(output).toContain("Verification successful");
    },
  );

  it.skipIf(!has("unzip"))("writes an archive unzip accepts", () => {
    const dir = mkdtempSync(join(tmpdir(), "pkpass-"));
    const file = join(dir, "t.pkpass");
    writeFileSync(
      file,
      buildPkPass({ formatVersion: 1 },
        [{ name: "icon.png", data: Buffer.alloc(64, 2) }], certs),
    );
    expect(execSync(`unzip -t ${file}`).toString()).toContain("No errors");
  });
});

describe("a complete pass, end to end", () => {
  const certs = testCertificates();

  it("builds one from real credential data and the shipped images", () => {
    /*
     * The closest thing to what a phone receives that can be checked without
     * one: the same `buildPassJson` the download route calls, the same brand
     * PNGs it reads off disk, packaged and signed the same way.
     */
    const brand = join(process.cwd(), "public", "brand");
    const mark = readFileSync(join(brand, "raceops-mark.png"));
    const logo = readFileSync(join(brand, "raceops-logo.png"));

    const passJson = buildPassJson(
      {
        token: "xQ7mA3pLn2ZbK9dR4tS8vWy1",
        holderName: "Jordan Alvarez",
        holderRole: "Driver",
        typeName: "Competitor",
        zones: [AccessZone.PADDOCK, AccessZone.PIT_LANE, AccessZone.GRID],
        teamName: "Apex Competition",
        carNumber: "24",
        serial: "P-0042",
        status: CredentialStatus.ISSUED,
        eventName: "Round 3 — Elkhart Lake",
        seriesName: "Demo Cup",
        eventDate: new Date(2026, 7, 20, 9, 0),
        venue: "Road America — Full Course",
        url: "https://raceops.test/pass/xQ7mA3pLn2ZbK9dR4tS8vWy1",
      },
      certs,
    );

    const files = readZip(
      buildPkPass(
        passJson,
        [
          { name: "icon.png", data: mark },
          { name: "icon@2x.png", data: mark },
          { name: "logo.png", data: logo },
          { name: "logo@2x.png", data: logo },
        ],
        certs,
      ),
    );

    // Everything iOS looks for, and nothing missing.
    expect([...files.keys()].sort()).toEqual([
      "icon.png",
      "icon@2x.png",
      "logo.png",
      "logo@2x.png",
      "manifest.json",
      "pass.json",
      "signature",
    ]);

    // The images survive the archive unchanged — a re-encoded PNG is a pass
    // whose manifest hash no longer matches.
    expect(files.get("icon.png")!.equals(mark)).toBe(true);
    expect(files.get("logo@2x.png")!.equals(logo)).toBe(true);

    // Every hash in the manifest matches what was actually shipped.
    const manifest = JSON.parse(files.get("manifest.json")!.toString());
    for (const [name, hash] of Object.entries(manifest)) {
      const actual = forge.md.sha1
        .create()
        .update(files.get(name)!.toString("binary"))
        .digest()
        .toHex();
      expect(actual, name).toBe(hash);
    }

    const shipped = JSON.parse(files.get("pass.json")!.toString());
    expect(shipped.eventTicket).toBeDefined();
    expect(shipped.serialNumber).toBe("xQ7mA3pLn2ZbK9dR4tS8vWy1");
    expect(shipped.barcodes[0].message).toContain("/pass/");
  });
});

describe("wallet images", () => {
  it("ships the PNGs a pass cannot install without", () => {
    /*
     * iOS rejects a pass with no icon.png even when the signature is perfect,
     * and says only that the pass cannot be installed. The download route
     * reads these from public/brand; if a rename moves them, the failure
     * appears on a phone rather than here.
     */
    for (const name of ["raceops-mark.png", "raceops-logo.png"]) {
      const file = join(process.cwd(), "public", "brand", name);
      expect(existsSync(file), name).toBe(true);
      expect(readFileSync(file).length, name).toBeGreaterThan(100);
    }
  });
});
